import { Button, Input, Select, Checkbox } from "./ui";
import { useEffect, useState } from "react";
import { Search, Plus, Check, Copy } from "lucide-react";
import { useData, Modal, ErrorBox, Loading, type Run } from "./components";
import { asset, bytes, type ImageItem, type Taxonomy } from "./api";
export default function Detail({
  image,
  version,
  onClose,
  run,
  onSimilar,
}: {
  image: ImageItem;
  version: number;
  onClose: () => void;
  run: Run;
  onSimilar: (i: ImageItem) => void;
}) {
  const { data: d, error } = useData<any>("detail", { id: image.id }, version),
    { data: taxonomy } = useData<Taxonomy>("taxonomy", {}, version);
  const [description, setDescription] = useState(""),
    [tag, setTag] = useState(""),
    [category, setCategory] = useState(""),
    [primary, setPrimary] = useState(true),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    if (d) setDescription(d.description || "");
  }, [d?.description]);
  return (
    <Modal title={image.name} onClose={onClose} wide>
      <ErrorBox error={error} />
      {!d ? (
        <Loading />
      ) : (
        <div className="detail-layout">
          <div className="original-preview">
            {d.status === "ready" ? (
              <img src={asset(d.path)} alt={d.name} />
            ) : (
              <div>
                <strong>图片无法预览</strong>
                <p>{d.error}</p>
              </div>
            )}
            <div className="preview-caption">
              {d.width || "–"} × {d.height || "–"} · {bytes(d.size)} ·{" "}
              {d.extension.toUpperCase()}
            </div>
          </div>
          <aside className="detail-info">
            <Button
              className="primary full-width"
              onClick={() => onSimilar(image)}
            >
              <Search size={16} />
              查找相似图片
            </Button>
            <section>
              <h3>图片描述</h3>
              <Input.TextArea
                aria-label="图片描述"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="添加描述，或配置模型自动生成…"
              />
              <Button
                disabled={description === (d.description || "")}
                onClick={() =>
                  void run(
                    "batch",
                    {
                      ids: [image.id],
                      action: "description",
                      text: description,
                    },
                    "描述已保存",
                  )
                }
              >
                <Check size={14} />
                保存描述
              </Button>
              <small>
                {d.description_edited
                  ? "由你编辑，AI 任务不会覆盖"
                  : "描述与向量独立保存"}
              </small>
            </section>
            <section>
              <h3>分类</h3>
              <div className="detail-chips">
                {d.categories.map((c: any) => (
                  <span key={c.id}>
                    {c.is_primary ? "★ " : ""}
                    {c.name}
                    <Button
                      aria-label={`移除分类 ${c.name}`}
                      onClick={() =>
                        void run("batch", {
                          ids: [image.id],
                          action: "remove_category",
                          category_id: c.id,
                        })
                      }
                    >
                      ×
                    </Button>
                  </span>
                ))}
              </div>
              <div className="inline-form">
                <Select
                  aria-label="图片分类"
                  value={category}
                  onChange={(value) => setCategory(value)}
                >
                  <option value="">选择分类</option>
                  {taxonomy?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Button
                  disabled={!category}
                  onClick={() =>
                    void run("batch", {
                      ids: [image.id],
                      action: "category",
                      category_id: Number(category),
                      primary,
                    })
                  }
                >
                  <Plus size={15} />
                </Button>
              </div>
              <Checkbox
                className="check-label"
                checked={primary}
                onChange={(e) => setPrimary(e.target.checked)}
              >
                设为主分类
              </Checkbox>
            </section>
            <section>
              <h3>标签</h3>
              <div className="detail-chips">
                {d.tags.map((t: any) => (
                  <span
                    key={t.id}
                    title={`${t.kind} · ${t.confirmed ? "已由用户确认" : `来源：${t.source}`} · ${t.created_at}`}
                  >
                    {t.name}
                    <Button
                      aria-label={`移除标签 ${t.name}`}
                      onClick={() =>
                        void run("batch", {
                          ids: [image.id],
                          action: "remove_tag",
                          tag_id: t.id,
                        })
                      }
                    >
                      ×
                    </Button>
                  </span>
                ))}
              </div>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void (async () => {
                    if (
                      await run("batch", {
                        ids: [image.id],
                        action: "add_tag",
                        name: tag,
                        kind: "主题",
                      })
                    )
                      setTag("");
                  })();
                }}
              >
                <Input
                  aria-label="添加图片标签"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder="添加标签…"
                />
                <Button type="submit" disabled={!tag.trim()}>
                  <Plus size={15} />
                </Button>
              </form>
            </section>
            <section>
              <h3>文件信息</h3>
              <p className="file-path">{d.path}</p>
              <Button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(d.path)
                    .then(() => setCopied(true))
                }
              >
                <Copy size={13} />
                {copied ? "已复制" : "复制路径"}
              </Button>
              <dl>
                <dt>创建时间</dt>
                <dd>
                  {d.created_at
                    ? new Date(d.created_at).toLocaleString()
                    : "未知"}
                </dd>
                <dt>修改时间</dt>
                <dd>
                  {d.modified
                    ? new Date(d.modified / 1e6).toLocaleString()
                    : "未知"}
                </dd>
                <dt>比例</dt>
                <dd>{d.ratio?.toFixed(3) || "—"}</dd>
                <dt>SHA-256</dt>
                <dd className="hash">{d.hash || "—"}</dd>
              </dl>
            </section>
            <details>
              <summary>向量索引 · {d.embeddings.length}</summary>
              {d.embeddings.length ? (
                d.embeddings.map((e: any, i: number) => (
                  <p key={i}>
                    {e.name} · {e.kind} · {e.dimension} 维 ·{" "}
                    {e.current ? "当前配置" : "已过期"}
                  </p>
                ))
              ) : (
                <p>尚未建立向量索引。</p>
              )}
            </details>
            <details>
              <summary>EXIF 元数据</summary>
              <dl>
                {Object.entries(JSON.parse(d.exif || "{}")).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </aside>
        </div>
      )}
    </Modal>
  );
}
