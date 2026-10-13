import { useEffect, useState } from "react";
import { Check, Copy, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Choice,
  ErrorBox,
  Loading,
  Modal,
  useData,
  type Run,
} from "./components";
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
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.9fr)]">
          <div className="flex min-h-80 flex-col overflow-hidden rounded-2xl bg-muted/80">
            {d.status === "ready" ? (
              <img
                src={asset(d.path)}
                alt={d.name}
                className="max-h-[calc(86vh-8rem)] w-full flex-1 object-contain"
              />
            ) : (
              <div className="space-y-2 p-6 text-center">
                <strong>图片无法预览</strong>
                <p className="text-sm text-muted-foreground">{d.error}</p>
              </div>
            )}
            <p className="w-full px-3 py-2 text-center text-xs text-muted-foreground">
              {d.width || "–"} × {d.height || "–"} · {bytes(d.size)} ·{" "}
              {d.extension.toUpperCase()}
            </p>
          </div>
          <aside className="flex flex-col gap-4">
            <Button onClick={() => onSimilar(image)}>
              <Search />
              查找相似图片
            </Button>
            <section className="space-y-3 border-t border-border/80 pt-4">
              <h3 className="text-sm font-medium">图片描述</h3>
              <Textarea
                aria-label="图片描述"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="添加描述，或配置模型自动生成…"
              />
              <Button
                variant="outline"
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
                <Check />
                保存描述
              </Button>
              <p className="text-xs text-muted-foreground">
                {d.description_edited
                  ? "由你编辑，AI 任务不会覆盖"
                  : "描述与向量独立保存"}
              </p>
            </section>
            <section className="space-y-3 border-t border-border/80 pt-4">
              <h3 className="text-sm font-medium">分类</h3>
              <div className="flex flex-wrap gap-2">
                {d.categories.map((c: any) => (
                  <Badge key={c.id} variant="secondary" className="gap-1 pr-1">
                    {c.is_primary ? "★ " : ""}
                    {c.name}
                    <Button
                      variant="ghost"
                      size="icon-xs"
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
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Choice
                  label="图片分类"
                  className="min-w-0 flex-1"
                  value={category || "none"}
                  onValueChange={(value) =>
                    setCategory(value === "none" ? "" : value)
                  }
                  options={[
                    { value: "none", label: "选择分类" },
                    ...(taxonomy?.categories.map((c) => ({
                      value: String(c.id),
                      label: c.name,
                    })) || []),
                  ]}
                />
                <Button
                  variant="outline"
                  size="icon"
                  disabled={!category}
                  aria-label="添加分类"
                  onClick={() =>
                    void run("batch", {
                      ids: [image.id],
                      action: "category",
                      category_id: Number(category),
                      primary,
                    })
                  }
                >
                  <Plus />
                </Button>
              </div>
              <Field orientation="horizontal">
                <Checkbox
                  id="primary-category"
                  checked={primary}
                  onCheckedChange={(checked) => setPrimary(checked === true)}
                />
                <FieldLabel htmlFor="primary-category">设为主分类</FieldLabel>
              </Field>
            </section>
            <section className="space-y-3 border-t border-border/80 pt-4">
              <h3 className="text-sm font-medium">标签</h3>
              <div className="flex flex-wrap gap-2">
                {d.tags.map((t: any) => (
                  <Badge
                    key={t.id}
                    variant="secondary"
                    className="gap-1 pr-1"
                    title={`${t.kind} · ${t.confirmed ? "已由用户确认" : `来源：${t.source}`} · ${t.created_at}`}
                  >
                    {t.name}
                    <Button
                      variant="ghost"
                      size="icon-xs"
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
                  </Badge>
                ))}
              </div>
              <form
                className="flex gap-2"
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
                <Button
                  type="submit"
                  variant="outline"
                  size="icon"
                  disabled={!tag.trim()}
                  aria-label="添加标签"
                >
                  <Plus />
                </Button>
              </form>
            </section>
            <section className="space-y-3 border-t border-border/80 pt-4">
              <h3 className="text-sm font-medium">文件信息</h3>
              <p className="text-xs break-all text-muted-foreground">{d.path}</p>
              <Button
                variant="outline"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(d.path)
                    .then(() => setCopied(true))
                }
              >
                <Copy />
                {copied ? "已复制" : "复制路径"}
              </Button>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">创建时间</dt>
                <dd>
                  {d.created_at
                    ? new Date(d.created_at).toLocaleString()
                    : "未知"}
                </dd>
                <dt className="text-muted-foreground">修改时间</dt>
                <dd>
                  {d.modified
                    ? new Date(d.modified / 1e6).toLocaleString()
                    : "未知"}
                </dd>
                <dt className="text-muted-foreground">比例</dt>
                <dd>{d.ratio?.toFixed(3) || "—"}</dd>
                <dt className="text-muted-foreground">SHA-256</dt>
                <dd className="font-mono text-xs break-all">{d.hash || "—"}</dd>
              </dl>
            </section>
            <Collapsible className="rounded-lg border px-3 py-2">
              <CollapsibleTrigger className="text-sm font-medium">
                向量索引 · {d.embeddings.length}
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 pt-2 text-sm text-muted-foreground">
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
              </CollapsibleContent>
            </Collapsible>
            <Collapsible className="rounded-lg border px-3 py-2">
              <CollapsibleTrigger className="text-sm font-medium">
                EXIF 元数据
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  {Object.entries(JSON.parse(d.exif || "{}")).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="break-all">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </CollapsibleContent>
            </Collapsible>
          </aside>
        </div>
      )}
    </Modal>
  );
}
