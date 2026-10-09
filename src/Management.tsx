import { Switch } from "antd";
import { Button, Select, Input, Checkbox } from "./ui";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderPlus,
  FolderOpen,
  RefreshCw,
  Trash2,
  Pause,
  Play,
  Square,
  Plus,
  Server,
  ShieldCheck,
  Check,
  FlaskConical,
  Pencil,
  ChevronRight,
  Tags,
  GitMerge,
} from "lucide-react";
import {
  useData,
  Heading,
  Empty,
  ErrorBox,
  Loading,
  Modal,
  SectionTitle,
  type Run,
} from "./components";
import {
  bytes,
  statusNames,
  taskNames,
  type Folder,
  type Category,
  type Taxonomy,
} from "./api";
export type Confirm = (
  title: string,
  body: string,
  action: () => Promise<void>,
) => void;

export function Jobs({ data, run }: { data: any; run: Run }) {
  return (
    <div className="jobs-list">
      {data?.items?.length ? (
        data.items.map((j: any) => (
          <div className="job" key={j.id}>
            <div className="job-top">
              <strong>
                {j.kind === "scan" ? "文件夹扫描" : taskNames[j.task] || j.task}
              </strong>
              <span className={`badge ${j.status}`}>
                {statusNames[j.status]}
              </span>
              <div className="spacer" />
              {j.status === "running" && (
                <Button
                  className="icon-button"
                  title="暂停任务"
                  onClick={() =>
                    void run("job_control", { id: j.id, action: "pause" })
                  }
                >
                  <Pause size={16} />
                </Button>
              )}
              {j.status === "paused" && (
                <Button
                  className="icon-button"
                  title="继续任务"
                  onClick={() =>
                    void run("job_control", { id: j.id, action: "resume" })
                  }
                >
                  <Play size={16} />
                </Button>
              )}
              {["running", "paused", "queued"].includes(j.status) && (
                <Button
                  className="icon-button"
                  title="取消任务"
                  onClick={() =>
                    void run("job_control", { id: j.id, action: "cancel" })
                  }
                >
                  <Square size={14} />
                </Button>
              )}
            </div>
            <p title={j.folder}>{j.folder || "AI 图片分析"}</p>
            <div
              className={`progress ${j.kind === "scan" && j.status === "running" ? "indeterminate" : ""}`}
            >
              <div
                style={{
                  width: `${j.total ? (100 * j.processed) / j.total : 0}%`,
                }}
              />
            </div>
            <div className="job-bottom">
              <span>
                {j.processed} 已处理 · {j.failed} 失败
                {j.kind === "ai"
                  ? ` · ${Math.max(0, j.total - j.processed)} 待处理`
                  : ""}
              </span>
              <span>
                {j.elapsed_ms > 0
                  ? `${(j.processed / (j.elapsed_ms / 1000)).toFixed(1)} 张/秒`
                  : ""}
              </span>
            </div>
            <small>{j.message}</small>
          </div>
        ))
      ) : (
        <Empty title="当前没有任务">添加文件夹后即可开始扫描。</Empty>
      )}
    </div>
  );
}
export function Folders({
  version,
  run,
  confirm,
  addFolder,
  jobs,
}: {
  version: number;
  run: Run;
  confirm: Confirm;
  addFolder: () => void;
  jobs: any;
}) {
  const { data, error, loading } = useData<Folder[]>("folders", {}, version);
  const [task, setTask] = useState("image_embedding");
  return (
    <>
      <Heading
        eyebrow="CONNECTED FOLDERS"
        title="连接你的图片世界"
        description="文件保持原位，SortNest 只建立索引。重新扫描时自动复用未变化的结果。"
        actions={
          <Button className="primary" onClick={addFolder}>
            <FolderPlus size={17} />
            添加文件夹
          </Button>
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data?.length ? (
        <div className="folder-list">
          {data.map((f) => (
            <section className="panel folder" key={f.id}>
              <div className="folder-icon">
                <FolderOpen size={28} />
              </div>
              <div className="folder-body">
                <h3 title={f.path}>{f.path}</h3>
                <p>
                  {f.count} 张图片 · {f.failed} 张失败 · {f.missing} 张已离线
                </p>
                <small>
                  最近扫描：{f.last_scan ? `${f.last_scan} UTC` : "尚未扫描"}
                </small>
              </div>
              <Button
                onClick={() =>
                  void run(
                    "job_start",
                    { kind: "scan", folder_id: f.id },
                    "扫描已开始",
                  )
                }
              >
                <RefreshCw size={15} />
                重新扫描
              </Button>
              <Button
                className="icon-button danger"
                aria-label={`移除目录 ${f.path}`}
                onClick={() =>
                  confirm(
                    "从索引中移除文件夹？",
                    "此操作会移除该目录的图片索引、标签关联和 AI 结果。磁盘上的原始图片会保留。",
                    async () => {
                      await run(
                        "folder_remove",
                        { id: f.id },
                        "已移除目录索引",
                      );
                    },
                  )
                }
              >
                <Trash2 size={17} />
              </Button>
            </section>
          ))}
        </div>
      ) : (
        <Empty title="还没有连接的文件夹">
          <p>选择一个或多个本地图片目录，建立你的图片库。</p>
          <Button className="primary" onClick={addFolder}>
            <FolderPlus size={16} />
            添加文件夹
          </Button>
        </Empty>
      )}
      <div className="dashboard-grid">
        <section className="panel">
          <SectionTitle>后台任务</SectionTitle>
          <Jobs data={jobs} run={run} />
        </section>
        <div>
          <section className="panel">
            <SectionTitle>分析整个图片库</SectionTitle>
            <p className="muted">
              仅处理当前有效图片。兼容的结果会复用，手动修正的描述和标签会保留。
            </p>
            <div className="inline-form">
              <Select
                aria-label="全库 AI 任务"
                value={task}
                onChange={(value) => setTask(value)}
              >
                {[
                  "image_embedding",
                  "description",
                  "tags",
                  "description_embedding",
                ].map((t) => (
                  <option key={t} value={t}>
                    {taskNames[t]}
                  </option>
                ))}
              </Select>
              <Button
                className="primary"
                onClick={() =>
                  void run("job_start", { kind: "ai", task }, "AI 任务已开始")
                }
              >
                运行任务
              </Button>
            </div>
          </section>
          <section className="panel error-panel">
            <SectionTitle>
              最近错误<span className="sub-label">最近 100 条</span>
            </SectionTitle>
            {jobs?.errors?.length ? (
              <div className="error-list">
                {jobs.errors.map((e: any) => (
                  <div key={e.id}>
                    <strong>{e.message}</strong>
                    <p>{e.path}</p>
                    <small>{e.created_at} UTC</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">暂无错误记录。</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

const newModel = {
  id: "",
  name: "",
  provider: "ollama",
  base_url: "http://127.0.0.1:11434",
  model: "",
  revision: "",
  remote_consent: false,
  api_key: "",
  clear_key: false,
  vision_prompt: "",
  vision_max_tokens: 4096,
};
export function Models({
  version,
  run,
  confirm,
}: {
  version: number;
  run: Run;
  confirm: Confirm;
}) {
  const { data, error } = useData<any>("models", {}, version);
  const [form, setForm] = useState<any>(null),
    [testing, setTesting] = useState(""),
    [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState<string[]>([]);
  const set = (key: string, value: unknown) =>
    setForm((f: any) => ({ ...f, [key]: value }));
  const test = async (id: string, kind: string) => {
    let path: unknown;
    if (kind === "image" || kind === "vision") {
      path = await open({
        multiple: false,
        filters: [
          {
            name: "测试图片",
            extensions: [
              "jpg",
              "jpeg",
              "png",
              "webp",
              "bmp",
              "gif",
              "tif",
              "tiff",
            ],
          },
        ],
      });
      if (!path) return;
    }
    setTesting(id + kind);
    await run("model_test", { id, kind, path }, "能力测试通过");
    setTesting("");
  };
  const save = async () => {
    setSaving(true);
    const result = await run("model_save", form, "模型配置已保存");
    setSaving(false);
    if (result) setForm(null);
  };
  return (
    <>
      <Heading
        eyebrow="AI MODEL STUDIO"
        title="为每个任务，选择合适的模型"
        description="先验证能力，再分配任务。连接测试与实际推理测试分别记录。"
        actions={
          <Button className="primary" onClick={() => setForm({ ...newModel })}>
            <Plus size={17} />
            添加模型
          </Button>
        }
      />
      <ErrorBox error={error} />
      <div className="privacy-banner">
        <ShieldCheck size={20} />
        <div>
          <strong>你的图片，由你决定如何处理</strong>
          <p>
            默认使用本地服务。远程模型必须主动确认后才能发送图片或文本；API Key
            存入 Windows 凭据管理器。
          </p>
        </div>
      </div>
      <div className="model-grid">
        {data?.items?.map((m: any) => (
          <section className="panel model-card" key={m.id}>
            <div className="model-title">
              <div className="model-icon">
                <Server size={23} />
              </div>
              <div>
                <h3>{m.name}</h3>
                <span>
                  {m.provider === "openai"
                    ? "OpenAI 兼容 API"
                    : m.provider === "wemm"
                      ? "本地 WeMM"
                      : "Ollama"}
                </span>
              </div>
              <div className="spacer" />
              <Button
                className="icon-button"
                title="编辑模型"
                onClick={() =>
                  setForm({
                    ...m,
                    remote_consent: !!m.remote_consent,
                    api_key: "",
                    clear_key: false,
                  })
                }
              >
                <Pencil size={16} />
              </Button>
              <Button
                className="icon-button danger"
                title="删除模型"
                onClick={() =>
                  confirm(
                    "删除模型配置？",
                    "此模型的向量索引和任务绑定将移除，原图保留。",
                    async () => {
                      await run("model_delete", { id: m.id }, "模型已删除");
                    },
                  )
                }
              >
                <Trash2 size={16} />
              </Button>
            </div>
            <code className="model-name">{m.model}</code>
            <p className="endpoint">{m.base_url}</p>
            {m.provider !== "wemm" && (
              <details className="test-result">
                <summary>
                  图片理解提示词 · 输出上限 {m.vision_max_tokens ?? 4096} tokens
                </summary>
                <pre>
                  {m.vision_prompt ||
                    "使用默认提示词：客观描述主体、场景、风格与色彩。"}
                </pre>
                <small>点击右上角编辑图标修改，保存后运行图片理解测试。</small>
              </details>
            )}
            {m.provider === "ollama" && (
              <p className="fine-print">
                先运行连接测试，再测试文本和图片嵌入。图片嵌入需要服务与模型共同支持；图片理解能力不能替代图片向量。
              </p>
            )}
            <div className="capabilities">
              {[
                ["text", "文本嵌入"],
                ["image", "图片嵌入"],
                ["vision", "图片理解"],
              ].map(([k, label]) => (
                <span key={k} className={m.capabilities[k] ? "verified" : ""}>
                  {m.capabilities[k] ? <Check size={12} /> : null}
                  {label}
                  {m.capabilities[k] && m.capabilities[`${k}_dimension`]
                    ? ` · ${m.capabilities[`${k}_dimension`]}维`
                    : ""}
                </span>
              ))}
            </div>
            <div className="model-index">
              {m.index_count} 条向量 · {m.stale_count} 条配置已过期 ·{" "}
              {m.has_key ? "已安全保存凭据" : "无 API Key"}
            </div>
            <div className="test-buttons">
              {[
                ["connection", "连接"],
                ["text", "文本"],
                ["image", "图片嵌入"],
                ["vision", "图片理解"],
              ].map(([k, label]) => (
                <Button
                  key={k}
                  disabled={!!testing}
                  onClick={() => void test(m.id, k)}
                >
                  <FlaskConical size={13} />
                  {testing === m.id + k ? "测试中…" : label}
                </Button>
              ))}
            </div>
            {m.test_result && (
              <details className="test-result">
                <summary>最近测试 · {m.last_test} UTC</summary>
                <pre>{m.test_result}</pre>
              </details>
            )}
          </section>
        ))}
      </div>
      {data?.items?.length === 0 && (
        <Empty title="配置你的第一个模型">
          <p>使用 Ollama 或本地 WeMM，也可以连接你选择的兼容 API。</p>
          <Button
            className="primary"
            onClick={() =>
              setForm({
                ...newModel,
                provider: "wemm",
                name: "本地 WeMM 2B",
                model: "WeMM-Embedding-2B",
                base_url: "http://127.0.0.1:8787",
              })
            }
          >
            配置本地 WeMM
          </Button>
        </Empty>
      )}
      <section className="panel assignments">
        <SectionTitle>模型任务分配</SectionTitle>
        <p className="muted">
          下拉列表只包含通过相应能力测试的模型。跨模态搜索还会检查模型指纹和向量维度。
        </p>
        <div className="assignment-grid">
          {[
            ["image_embedding", "image"],
            ["text_embedding", "text"],
            ["description", "vision"],
            ["tags", "vision"],
          ].map(([task, cap]) => (
            <label key={task}>
              {taskNames[task]}
              <Select
                value={
                  data?.assignments?.find((a: any) => a.task === task)
                    ?.model_id || ""
                }
                onChange={(value) =>
                  void run(
                    "assign",
                    { task, model_id: value },
                    "任务模型已更新",
                  )
                }
              >
                <option value="">未分配</option>
                {data?.items
                  ?.filter((m: any) => m.capabilities[cap])
                  .map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </label>
          ))}
        </div>
      </section>
      <section className="panel setup-note">
        <SectionTitle>本地 WeMM 服务</SectionTitle>
        <p>
          在项目目录打开终端，使用独立 Conda 环境启动推理服务。默认使用
          CPU，适合当前 4GB 显存设备。
        </p>
        <pre>
          conda activate sortnest{"\n"}python -s services/wemm_server.py
          --model-dir ./WeMM-Embedding-2B --device cpu
        </pre>
        <p className="fine-print">
          Base URL：http://127.0.0.1:8787 · 模型名：WeMM-Embedding-2B。WeMM
          仅生成向量，不生成描述或标签。
        </p>
      </section>
      {form && (
        <Modal
          title={form.id ? "编辑模型配置" : "添加模型配置"}
          onClose={() => setForm(null)}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>
              配置名称
              <Input
                required
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="例如：本地图片检索模型"
              />
            </label>
            <label>
              提供商
              <Select
                value={form.provider}
                onChange={(value) => {
                  const p = value;
                  setForm((f: any) => ({
                    ...f,
                    provider: p,
                    base_url:
                      p === "ollama"
                        ? "http://127.0.0.1:11434"
                        : p === "wemm"
                          ? "http://127.0.0.1:8787"
                          : "https://api.openai.com/v1",
                    model: p === "wemm" ? "WeMM-Embedding-2B" : "",
                  }));
                }}
              >
                <option value="ollama">Ollama</option>
                <option value="openai">OpenAI 兼容 API</option>
                <option value="wemm">本地 WeMM</option>
              </Select>
            </label>
            <label>
              Base URL
              <Input
                required
                type="url"
                value={form.base_url}
                onChange={(e) => set("base_url", e.target.value)}
              />
              <small>
                支持 http:// 和 https://，可填写局域网 IP 或远程域名。
              </small>
            </label>
            <label>
              模型名称
              <Input
                required
                list="deployed-models"
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
              />
              <datalist id="deployed-models">
                {catalog.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <Button
                type="button"
                disabled={saving}
                onClick={() =>
                  void (async () => {
                    setSaving(true);
                    const names = await run(
                      "model_catalog",
                      form,
                      "模型列表已读取",
                    );
                    if (names) setCatalog(names);
                    setSaving(false);
                  })()
                }
              >
                读取服务已部署模型
              </Button>
            </label>
            <label>
              模型版本 / 配置标识
              <Input
                value={form.revision}
                onChange={(e) => set("revision", e.target.value)}
                placeholder="模型权重或参数更换时更新此值"
              />
            </label>
            {form.provider !== "wemm" && (
              <>
                <label>
                  图片理解提示词
                  <Input.TextArea
                    value={form.vision_prompt ?? ""}
                    onChange={(e) => set("vision_prompt", e.target.value)}
                    autoSize={{ minRows: 4, maxRows: 10 }}
                    maxLength={8000}
                    placeholder="用一到三句中文客观描述图片的主体、场景、风格与色彩。仅返回描述，不要推测身份或不可见的细节。"
                  />
                  <small>
                    留空使用默认提示词。用于图片理解测试和描述任务；分类标签任务会参考内容偏好，并保留必需的
                    JSON 格式。GIF 只分析单帧。
                  </small>
                </label>
                <label>
                  图片理解输出上限（tokens）
                  <Input
                    type="number"
                    required
                    min={256}
                    max={32768}
                    step={1}
                    value={form.vision_max_tokens ?? 4096}
                    onChange={(e) =>
                      set(
                        "vision_max_tokens",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                  <small>
                    默认 4096。若提示额度耗尽或只有推理内容，可尝试
                    8192；实际最大值取决于服务，增大会增加耗时和用量。
                  </small>
                </label>
                <p className="fine-print">
                  修改后需重新测试图片理解。再次运行任务会更新已有 AI
                  描述和标签，保留人工修改；图片向量索引不受影响。
                </p>
              </>
            )}
            <label>
              API Key
              <Input
                type="password"
                autoComplete="new-password"
                value={form.api_key}
                onChange={(e) => set("api_key", e.target.value)}
                placeholder={
                  form.has_key ? "留空保留已存凭据" : "本地服务可留空"
                }
              />
            </label>
            {form.has_key && (
              <Checkbox
                className="check-label"
                checked={form.clear_key}
                onChange={(e) => set("clear_key", e.target.checked)}
              >
                移除已保存的 API Key
              </Checkbox>
            )}
            <Checkbox
              className="check-label consent"
              checked={form.remote_consent}
              onChange={(e) => set("remote_consent", e.target.checked)}
            >
              允许此配置向远程服务发送查询文本和图片内容（非本机地址必须勾选）
            </Checkbox>
            <Button type="submit" className="primary" disabled={saving}>
              {saving ? "正在保存…" : "保存模型"}
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}

export function Taxonomies({
  mode,
  version,
  run,
  confirm,
  navigate,
}: {
  mode: string;
  version: number;
  run: Run;
  confirm: Confirm;
  navigate: (page: string, filter?: Record<string, unknown>) => void;
}) {
  const { data, error } = useData<Taxonomy>("taxonomy", {}, version);
  const [edit, setEdit] = useState<any>(null),
    [merge, setMerge] = useState<Category | null>(null),
    [target, setTarget] = useState(""),
    [query, setQuery] = useState("");
  const isCat = mode === "categories";
  const rows = (parent: number | null, depth = 0): React.ReactNode =>
    data?.categories
      .filter((c) => c.parent_id === parent)
      .map((c) => (
        <div key={c.id}>
          <div
            className="taxonomy-row"
            style={{ paddingLeft: 20 + depth * 24 }}
          >
            <button
              className="taxonomy-name"
              onClick={() => navigate("library", { category_id: c.id })}
            >
              <FolderOpen size={18} />
              {c.name}
              <span>{c.count}</span>
            </button>
            <Button
              className="icon-button"
              title="添加子分类"
              onClick={() => setEdit({ name: "", parent_id: c.id })}
            >
              <Plus size={16} />
            </Button>
            <Button
              className="icon-button"
              title="编辑分类"
              onClick={() => setEdit(c)}
            >
              <Pencil size={15} />
            </Button>
            <Button
              className="icon-button"
              title="合并分类"
              onClick={() => {
                setMerge(c);
                setTarget("");
              }}
            >
              <GitMerge size={16} />
            </Button>
            <Button
              className="icon-button danger"
              title="删除分类"
              onClick={() =>
                confirm(
                  "删除此分类？",
                  "图片会保留；子分类将提升为根分类。",
                  async () => {
                    await run(
                      "category",
                      { id: c.id, action: "delete" },
                      "分类已删除",
                    );
                  },
                )
              }
            >
              <Trash2 size={15} />
            </Button>
            <ChevronRight size={16} />
          </div>
          {rows(c.id, depth + 1)}
        </div>
      ));
  return (
    <>
      <Heading
        eyebrow={isCat ? "A PLACE FOR EVERYTHING" : "SMALL TAGS, BIG IDEAS"}
        title={isCat ? "分类，让灵感有迹可循" : "标签，连接每一种灵感"}
        description={
          isCat
            ? "建立属于你的分类层级，图片可以同时属于多个分类。"
            : "按主体、场景、风格等维度整理标签。点击标签查看对应图片。"
        }
        actions={
          isCat ? (
            <Button
              className="primary"
              onClick={() => setEdit({ name: "", parent_id: null })}
            >
              <Plus size={17} />
              新建分类
            </Button>
          ) : undefined
        }
      />
      <ErrorBox error={error} />
      {isCat ? (
        <section className="panel taxonomy-tree">{rows(null)}</section>
      ) : (
        <>
          <div className="library-toolbar">
            <Input
              className="tag-search"
              aria-label="搜索标签"
              placeholder="搜索标签…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="muted">{data?.tags.length || 0} 个标签</span>
          </div>
          {data?.tags.length ? (
            <div className="tag-grid">
              {data.tags
                .filter((t) => t.name.includes(query) || t.kind.includes(query))
                .map((t) => (
                  <div className="panel tag-card" key={t.id}>
                    <button
                      onClick={() => navigate("library", { tag_id: t.id })}
                    >
                      <Tags size={19} />
                      <strong>{t.name}</strong>
                      <span>{t.count} 张图片</span>
                      <small>{t.kind}</small>
                    </button>
                    <div>
                      <Button
                        className="icon-button"
                        aria-label={`编辑标签 ${t.name}`}
                        onClick={() => setEdit(t)}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        className="icon-button danger"
                        aria-label={`删除标签 ${t.name}`}
                        onClick={() =>
                          confirm(
                            "删除标签及其关联？",
                            "此标签将从所有图片中移除，原始图片会保留。",
                            async () => {
                              await run(
                                "tag_delete",
                                { id: t.id },
                                "标签已删除",
                              );
                            },
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <Empty title="还没有标签">
              在图片库中批量添加标签，或使用图片理解模型生成标签。
            </Empty>
          )}
        </>
      )}
      {edit && (
        <Modal
          title={isCat ? "编辑分类" : "编辑标签"}
          onClose={() => setEdit(null)}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                const r = await run(
                  isCat ? "category" : "tag_save",
                  edit,
                  "已保存",
                );
                if (r) setEdit(null);
              })();
            }}
          >
            <label>
              名称
              <Input
                required
                autoFocus
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            {isCat ? (
              <label>
                父分类
                <Select
                  value={edit.parent_id || ""}
                  onChange={(value) =>
                    setEdit({
                      ...edit,
                      parent_id: value ? Number(value) : null,
                    })
                  }
                >
                  <option value="">根分类</option>
                  {data?.categories
                    .filter((c) => c.id !== edit.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </Select>
              </label>
            ) : (
              <label>
                类型
                <Input
                  required
                  value={edit.kind}
                  onChange={(e) => setEdit({ ...edit, kind: e.target.value })}
                />
              </label>
            )}
            <Button type="submit" className="primary">
              保存
            </Button>
          </form>
        </Modal>
      )}
      {merge && (
        <Modal title={`合并「${merge.name}」`} onClose={() => setMerge(null)}>
          <div className="form-stack">
            <p>图片关联将转入目标分类，当前分类将被移除。</p>
            <label>
              目标分类
              <Select value={target} onChange={(value) => setTarget(value)}>
                <option value="">选择分类</option>
                {data?.categories
                  .filter((c) => c.id !== merge.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </label>
            <Button
              className="primary"
              disabled={!target}
              onClick={() =>
                void (async () => {
                  const r = await run(
                    "category",
                    { id: merge.id, target: Number(target), action: "merge" },
                    "分类已合并",
                  );
                  if (r) setMerge(null);
                })()
              }
            >
              确认合并
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function Settings({ version, run }: { version: number; run: Run }) {
  const { data: d, error } = useData<any>("settings", {}, version);
  return (
    <>
      <Heading
        eyebrow="MADE FOR YOUR WORKFLOW"
        title="设置"
        description="本地存储、隐私和运行状态。"
      />
      <ErrorBox error={error} />
      <div className="settings-grid">
        <section className="panel">
          <SectionTitle>存储与缓存</SectionTitle>
          <dl>
            <dt>数据库</dt>
            <dd>{d?.database || "—"}</dd>
            <dt>缩略图缓存</dt>
            <dd>{d?.cache || "—"}</dd>
            <dt>缓存大小</dt>
            <dd>{bytes(d?.cache_bytes)}</dd>
          </dl>
          <Button
            onClick={() =>
              void run("cache_prune", {}, "已清理不再使用的缩略图")
            }
          >
            <Trash2 size={15} />
            清理未使用缓存
          </Button>
          <p className="fine-print">
            备份时先关闭应用，再复制整个数据目录。可用 SORTNEST_DATA_DIR
            环境变量指定新存储目录；不会自动迁移旧库。
          </p>
        </section>
        <section className="panel">
          <SectionTitle>隐私与资源</SectionTitle>
          <div className="toggle-line">
            <div>
              <strong>读取 EXIF 元数据</strong>
              <p>可能包含拍摄设备和地理位置信息</p>
            </div>
            <Switch
              aria-label="读取 EXIF 元数据"

              checked={
                d?.values?.find((x: any) => x.key === "read_exif")?.value ===
                "true"
              }
              onChange={(checked) =>
                void run(
                  "settings_save",
                  { key: "read_exif", value: String(checked) },
                  "隐私设置已更新",
                )
              }
            />
          </div>
          <dl>
            <dt>模型请求并发</dt>
            <dd>1（串行，优先控制本机资源）</dd>
            <dt>图片解码并发</dt>
            <dd>1 · 单张解码内存上限 256 MB</dd>
            <dt>应用进程内存</dt>
            <dd>{bytes(d?.memory)}</dd>
            <dt>原图处理策略</dt>
            <dd>只读，不移动或修改</dd>
            <dt>HEIC / HEIF</dt>
            <dd>当前解码器不支持，将记录失败并继续扫描</dd>
            <dt>版本</dt>
            <dd>SortNest {d?.version || "0.1.0"}</dd>
          </dl>
        </section>
      </div>
    </>
  );
}
