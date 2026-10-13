import { useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  ChevronRight,
  FlaskConical,
  FolderOpen,
  FolderPlus,
  GitMerge,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
  Tags,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Choice,
  EmptyState,
  ErrorBox,
  Heading,
  Loading,
  Modal,
  NONE,
  ROOT,
  SectionTitle,
  useData,
  type Run,
} from "./components";
import {
  bytes,
  statusNames,
  taskNames,
  type Category,
  type Folder,
  type Taxonomy,
} from "./api";

export type Confirm = (
  title: string,
  body: string,
  action: () => Promise<void>,
) => void;

const aiTasks = [
  "image_embedding",
  "description",
  "tags",
  "description_embedding",
];

function IconButton({
  label,
  destructive = false,
  onClick,
  children,
}: {
  label: string;
  destructive?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={destructive ? "destructive" : "ghost"}
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function statusVariant(status: string) {
  if (status === "failed" || status === "cancelled") return "destructive" as const;
  if (status === "running" || status === "completed") return "default" as const;
  if (status === "paused") return "secondary" as const;
  return "outline" as const;
}

export function Jobs({ data, run }: { data: any; run: Run }) {
  return (
    <div className="flex flex-col gap-3">
      {data?.items?.length ? (
        data.items.map((j: any) => (
          <Card key={j.id} size="sm">
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                <strong className="text-sm">
                  {j.kind === "scan"
                    ? "文件夹扫描"
                    : taskNames[j.task] || j.task}
                </strong>
                <Badge variant={statusVariant(j.status)}>
                  {statusNames[j.status]}
                </Badge>
                <div className="ml-auto flex gap-1">
                  {j.status === "running" ? (
                    <IconButton
                      label="暂停任务"
                      onClick={() =>
                        void run("job_control", { id: j.id, action: "pause" })
                      }
                    >
                      <Pause />
                    </IconButton>
                  ) : null}
                  {j.status === "paused" ? (
                    <IconButton
                      label="继续任务"
                      onClick={() =>
                        void run("job_control", { id: j.id, action: "resume" })
                      }
                    >
                      <Play />
                    </IconButton>
                  ) : null}
                  {["running", "paused", "queued"].includes(j.status) ? (
                    <IconButton
                      label="取消任务"
                      onClick={() =>
                        void run("job_control", { id: j.id, action: "cancel" })
                      }
                    >
                      <Square />
                    </IconButton>
                  ) : null}
                </div>
              </div>
              <p className="truncate text-sm text-muted-foreground" title={j.folder}>
                {j.folder || "AI 图片分析"}
              </p>
              <Progress
                value={j.total ? (100 * j.processed) / j.total : 0}
                indeterminate={j.kind === "scan" && j.status === "running"}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
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
              <p className="text-xs text-muted-foreground">{j.message}</p>
            </CardContent>
          </Card>
        ))
      ) : (
        <EmptyState title="当前没有任务">添加文件夹后即可开始扫描。</EmptyState>
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
  const canClearJobs = jobs?.items?.some(
    (job: { status: string }) =>
      !["running", "paused", "queued"].includes(job.status),
  );
  const canClearErrors = (jobs?.errors?.length ?? 0) > 0;
  return (
    <>
      <Heading
        eyebrow="CONNECTED FOLDERS"
        title="连接你的图片世界"
        description="文件保持原位，SortNest 只建立索引。重新扫描时自动复用未变化的结果。"
        actions={
          <Button onClick={addFolder}>
            <FolderPlus />
            添加文件夹
          </Button>
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data?.length ? (
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="divide-y px-0">
          {data.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-4 px-4 py-4">
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <FolderOpen className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium" title={f.path}>
                    {f.path}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {f.count} 张图片 · {f.failed} 张失败 · {f.missing} 张已离线
                  </p>
                  <p className="text-xs text-muted-foreground">
                    最近扫描：{f.last_scan ? `${f.last_scan} UTC` : "尚未扫描"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() =>
                    void run(
                      "job_start",
                      { kind: "scan", folder_id: f.id },
                      "扫描已开始",
                    )
                  }
                >
                  <RefreshCw />
                  重新扫描
                </Button>
                <IconButton
                  destructive
                  label={`移除目录 ${f.path}`}
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
                  <Trash2 />
                </IconButton>
            </div>
          ))}
          </CardContent>
        </Card>
      ) : (
        <EmptyState title="还没有连接的文件夹">
          <p>选择一个或多个本地图片目录，建立你的图片库。</p>
          <Button onClick={addFolder}>
            <FolderPlus />
            添加文件夹
          </Button>
        </EmptyState>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <SectionTitle>后台任务</SectionTitle>
            <Button
              variant="outline"
              size="sm"
              disabled={!canClearJobs}
              onClick={() =>
                confirm(
                  "清除已结束的任务记录？",
                  "正在运行、已暂停和排队中的任务会保留。图片和索引不会删除。",
                  async () => {
                    await run("history_clear", { target: "jobs" }, "任务历史已清除");
                  },
                )
              }
            >
              <Trash2 />
              清除历史
            </Button>
          </CardHeader>
          <CardContent>
            <Jobs data={jobs} run={run} />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <SectionTitle>分析整个图片库</SectionTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                仅处理当前有效图片。兼容的结果会复用，手动修正的描述和标签会保留。
              </p>
              <div className="flex gap-2">
                <Choice
                  label="全库 AI 任务"
                  className="min-w-0 flex-1"
                  value={task}
                  onValueChange={setTask}
                  options={aiTasks.map((item) => ({
                    value: item,
                    label: taskNames[item],
                  }))}
                />
                <Button
                  onClick={() =>
                    void run("job_start", { kind: "ai", task }, "AI 任务已开始")
                  }
                >
                  运行任务
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <SectionTitle>
                最近错误
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  最近 100 条
                </span>
              </SectionTitle>
              <Button
                variant="outline"
                size="sm"
                disabled={!canClearErrors}
                onClick={() =>
                  confirm(
                    "清除错误记录？",
                    "只删除错误日志。图片、索引和仍在进行的任务都会保留。",
                    async () => {
                      await run(
                        "history_clear",
                        { target: "errors" },
                        "错误历史已清除",
                      );
                    },
                  )
                }
              >
                <Trash2 />
                清除历史
              </Button>
            </CardHeader>
            <CardContent>
              {jobs?.errors?.length ? (
                <div className="h-64 space-y-3 overflow-y-auto pr-3">
                    {jobs.errors.map((e: any) => (
                      <div key={e.id} className="text-sm">
                        <strong>{e.message}</strong>
                        <p className="break-all text-muted-foreground">{e.path}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.created_at} UTC
                        </p>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">暂无错误记录。</p>
              )}
            </CardContent>
          </Card>
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
          <Button onClick={() => setForm({ ...newModel })}>
            <Plus />
            添加模型
          </Button>
        }
      />
      <ErrorBox error={error} />
      <div className="flex items-start gap-3 rounded-2xl bg-primary/5 px-4 py-4 ring-1 ring-primary/10">
          <ShieldCheck className="mt-0.5 text-primary" />
          <div>
            <strong className="text-sm">你的图片，由你决定如何处理</strong>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              默认使用本地服务。远程模型必须主动确认后才能发送图片或文本；API Key
              存入 Windows 凭据管理器。
            </p>
          </div>
        </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {data?.items?.map((m: any) => (
          <Card key={m.id}>
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-start gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Server className="size-4" />
                </div>
                <div>
                  <h3 className="font-medium">{m.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {m.provider === "openai"
                      ? "OpenAI 兼容 API"
                      : m.provider === "wemm"
                        ? "本地 WeMM"
                        : "Ollama"}
                  </p>
                </div>
                <div className="ml-auto flex gap-1">
                  <IconButton
                    label="编辑模型"
                    onClick={() =>
                      setForm({
                        ...m,
                        remote_consent: !!m.remote_consent,
                        api_key: "",
                        clear_key: false,
                      })
                    }
                  >
                    <Pencil />
                  </IconButton>
                  <IconButton
                    destructive
                    label="删除模型"
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
                    <Trash2 />
                  </IconButton>
                </div>
              </div>
              <code className="block text-sm">{m.model}</code>
              <p className="text-sm break-all text-muted-foreground">
                {m.base_url}
              </p>
              {m.provider !== "wemm" ? (
                <Collapsible className="rounded-lg border px-3 py-2 text-sm">
                  <CollapsibleTrigger>
                    图片理解提示词 · 输出上限 {m.vision_max_tokens ?? 4096}{" "}
                    tokens
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 pt-2">
                    <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {m.vision_prompt ||
                        "使用默认提示词：客观描述主体、场景、风格与色彩。"}
                    </pre>
                    <p className="text-xs text-muted-foreground">
                      点击右上角编辑图标修改，保存后运行图片理解测试。
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
              {m.provider === "ollama" ? (
                <p className="text-xs leading-6 text-muted-foreground">
                  先运行连接测试，再测试文本和图片嵌入。图片嵌入需要服务与模型共同支持；图片理解能力不能替代图片向量。
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["text", "文本嵌入"],
                    ["image", "图片嵌入"],
                    ["vision", "图片理解"],
                  ] as const
                ).map(([k, label]) => (
                  <Badge
                    key={k}
                    variant={m.capabilities[k] ? "default" : "outline"}
                  >
                    {m.capabilities[k] ? <Check /> : null}
                    {label}
                    {m.capabilities[k] && m.capabilities[`${k}_dimension`]
                      ? ` · ${m.capabilities[`${k}_dimension`]}维`
                      : ""}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {m.index_count} 条向量 · {m.stale_count} 条配置已过期 ·{" "}
                {m.has_key ? "已安全保存凭据" : "无 API Key"}
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["connection", "连接"],
                    ["text", "文本"],
                    ["image", "图片嵌入"],
                    ["vision", "图片理解"],
                  ] as const
                ).map(([k, label]) => (
                  <Button
                    key={k}
                    variant="outline"
                    disabled={!!testing}
                    onClick={() => void test(m.id, k)}
                  >
                    <FlaskConical />
                    {testing === m.id + k ? "测试中…" : label}
                  </Button>
                ))}
              </div>
              {m.test_result ? (
                <Collapsible className="rounded-lg border px-3 py-2 text-sm">
                  <CollapsibleTrigger>
                    最近测试 · {m.last_test} UTC
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="pt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                      {m.test_result}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      {data?.items?.length === 0 ? (
        <EmptyState title="配置你的第一个模型">
          <p>使用 Ollama 或本地 WeMM，也可以连接你选择的兼容 API。</p>
          <Button
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
        </EmptyState>
      ) : null}
      <Card>
        <CardHeader>
          <SectionTitle>模型任务分配</SectionTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            下拉列表只包含通过相应能力测试的模型。跨模态搜索还会检查模型指纹和向量维度。
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {(
              [
                ["image_embedding", "image"],
                ["text_embedding", "text"],
                ["description", "vision"],
                ["tags", "vision"],
              ] as const
            ).map(([task, cap]) => (
              <Field key={task}>
                <FieldLabel>{taskNames[task]}</FieldLabel>
                <Choice
                  label={taskNames[task]}
                  value={
                    data?.assignments?.find((a: any) => a.task === task)
                      ?.model_id || NONE
                  }
                  onValueChange={(value) =>
                    void run(
                      "assign",
                      { task, model_id: value === NONE ? "" : value },
                      "任务模型已更新",
                    )
                  }
                  options={[
                    { value: NONE, label: "未分配" },
                    ...(data?.items
                      ?.filter((m: any) => m.capabilities[cap])
                      .map((m: any) => ({ value: m.id, label: m.name })) || []),
                  ]}
                />
              </Field>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <SectionTitle>本地 WeMM 服务</SectionTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            在项目目录打开终端，使用独立 Conda 环境启动推理服务。默认使用
            CPU，适合当前 4GB 显存设备。
          </p>
          <pre className="overflow-auto rounded-lg bg-muted p-3 text-xs">
            conda activate sortnest{"\n"}python -s services/wemm_server.py
            --model-dir ./WeMM-Embedding-2B --device cpu
          </pre>
          <p className="text-xs text-muted-foreground">
            Base URL：http://127.0.0.1:8787 · 模型名：WeMM-Embedding-2B。WeMM
            仅生成向量，不生成描述或标签。
          </p>
        </CardContent>
      </Card>
      {form ? (
        <Modal
          title={form.id ? "编辑模型配置" : "添加模型配置"}
          onClose={() => setForm(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="model-name">配置名称</FieldLabel>
                <Input
                  id="model-name"
                  required
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="例如：本地图片检索模型"
                />
              </Field>
              <Field>
                <FieldLabel>提供商</FieldLabel>
                <Choice
                  label="提供商"
                  value={form.provider}
                  onValueChange={(value) => {
                    setForm((f: any) => ({
                      ...f,
                      provider: value,
                      base_url:
                        value === "ollama"
                          ? "http://127.0.0.1:11434"
                          : value === "wemm"
                            ? "http://127.0.0.1:8787"
                            : "https://api.openai.com/v1",
                      model: value === "wemm" ? "WeMM-Embedding-2B" : "",
                    }));
                  }}
                  options={[
                    { value: "ollama", label: "Ollama" },
                    { value: "openai", label: "OpenAI 兼容 API" },
                    { value: "wemm", label: "本地 WeMM" },
                  ]}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="base-url">Base URL</FieldLabel>
                <Input
                  id="base-url"
                  required
                  type="url"
                  value={form.base_url}
                  onChange={(e) => set("base_url", e.target.value)}
                />
                <FieldDescription>
                  支持 http:// 和 https://，可填写局域网 IP 或远程域名。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="model-id">模型名称</FieldLabel>
                <Input
                  id="model-id"
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
                  variant="outline"
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
              </Field>
              <Field>
                <FieldLabel htmlFor="revision">模型版本 / 配置标识</FieldLabel>
                <Input
                  id="revision"
                  value={form.revision}
                  onChange={(e) => set("revision", e.target.value)}
                  placeholder="模型权重或参数更换时更新此值"
                />
              </Field>
              {form.provider !== "wemm" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="vision-prompt">图片理解提示词</FieldLabel>
                    <Textarea
                      id="vision-prompt"
                      value={form.vision_prompt ?? ""}
                      onChange={(e) => set("vision_prompt", e.target.value)}
                      rows={4}
                      maxLength={8000}
                      placeholder="用一到三句中文客观描述图片的主体、场景、风格与色彩。仅返回描述，不要推测身份或不可见的细节。"
                    />
                    <FieldDescription>
                      留空使用默认提示词。用于图片理解测试和描述任务；分类标签任务会参考内容偏好，并保留必需的
                      JSON 格式。GIF 只分析单帧。
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="vision-tokens">
                      图片理解输出上限（tokens）
                    </FieldLabel>
                    <Input
                      id="vision-tokens"
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
                    <FieldDescription>
                      默认 4096。若提示额度耗尽或只有推理内容，可尝试
                      8192；实际最大值取决于服务，增大会增加耗时和用量。
                    </FieldDescription>
                  </Field>
                  <p className="text-xs leading-6 text-muted-foreground">
                    修改后需重新测试图片理解。再次运行任务会更新已有 AI
                    描述和标签，保留人工修改；图片向量索引不受影响。
                  </p>
                </>
              ) : null}
              <Field>
                <FieldLabel htmlFor="api-key">API Key</FieldLabel>
                <Input
                  id="api-key"
                  type="password"
                  autoComplete="new-password"
                  value={form.api_key}
                  onChange={(e) => set("api_key", e.target.value)}
                  placeholder={
                    form.has_key ? "留空保留已存凭据" : "本地服务可留空"
                  }
                />
              </Field>
              {form.has_key ? (
                <Field orientation="horizontal">
                  <Checkbox
                    id="clear-key"
                    checked={form.clear_key}
                    onCheckedChange={(checked) =>
                      set("clear_key", checked === true)
                    }
                  />
                  <FieldLabel htmlFor="clear-key">
                    移除已保存的 API Key
                  </FieldLabel>
                </Field>
              ) : null}
              <Field orientation="horizontal">
                <Checkbox
                  id="remote-consent"
                  checked={form.remote_consent}
                  onCheckedChange={(checked) =>
                    set("remote_consent", checked === true)
                  }
                />
                <FieldLabel htmlFor="remote-consent">
                  允许此配置向远程服务发送查询文本和图片内容（非本机地址必须勾选）
                </FieldLabel>
              </Field>
              <Button type="submit" disabled={saving}>
                {saving ? "正在保存…" : "保存模型"}
              </Button>
            </FieldGroup>
          </form>
        </Modal>
      ) : null}
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
  const rows = (parent: number | null, depth = 0): ReactNode =>
    data?.categories
      .filter((c) => c.parent_id === parent)
      .map((c) => (
        <div key={c.id}>
          <div
            className="flex items-center gap-1 py-1"
            style={{ paddingLeft: 8 + depth * 24 }}
          >
            <Button
              variant="ghost"
              className="h-auto min-w-0 flex-1 justify-start"
              onClick={() => navigate("library", { category_id: c.id })}
            >
              <FolderOpen />
              <span className="truncate">{c.name}</span>
              <Badge variant="secondary">{c.count}</Badge>
            </Button>
            <IconButton
              label="添加子分类"
              onClick={() => setEdit({ name: "", parent_id: c.id })}
            >
              <Plus />
            </IconButton>
            <IconButton label="编辑分类" onClick={() => setEdit(c)}>
              <Pencil />
            </IconButton>
            <IconButton
              label="合并分类"
              onClick={() => {
                setMerge(c);
                setTarget("");
              }}
            >
              <GitMerge />
            </IconButton>
            <IconButton
              destructive
              label="删除分类"
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
              <Trash2 />
            </IconButton>
            <ChevronRight className="size-4 text-muted-foreground" />
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
            <Button onClick={() => setEdit({ name: "", parent_id: null })}>
              <Plus />
              新建分类
            </Button>
          ) : undefined
        }
      />
      <ErrorBox error={error} />
      {isCat ? (
        <Card>
          <CardContent className="pt-4">{rows(null)}</CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              className="max-w-sm"
              aria-label="搜索标签"
              placeholder="搜索标签…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">
              {data?.tags.length || 0} 个标签
            </span>
          </div>
          {data?.tags.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.tags
                .filter((t) => t.name.includes(query) || t.kind.includes(query))
                .map((t) => (
                  <Card key={t.id}>
                    <CardContent className="flex items-start gap-2 pt-6">
                      <Button
                        variant="ghost"
                        className="h-auto min-w-0 flex-1 flex-col items-start"
                        onClick={() => navigate("library", { tag_id: t.id })}
                      >
                        <Tags />
                        <strong>{t.name}</strong>
                        <span className="text-xs font-normal text-muted-foreground">
                          {t.count} 张图片
                        </span>
                        <small className="text-xs text-muted-foreground">
                          {t.kind}
                        </small>
                      </Button>
                      <IconButton
                        label={`编辑标签 ${t.name}`}
                        onClick={() => setEdit(t)}
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        destructive
                        label={`删除标签 ${t.name}`}
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
                        <Trash2 />
                      </IconButton>
                    </CardContent>
                  </Card>
                ))}
            </div>
          ) : (
            <EmptyState title="还没有标签">
              在图片库中批量添加标签，或使用图片理解模型生成标签。
            </EmptyState>
          )}
        </>
      )}
      {edit ? (
        <Modal
          title={isCat ? "编辑分类" : "编辑标签"}
          onClose={() => setEdit(null)}
        >
          <form
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
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="taxonomy-name">名称</FieldLabel>
                <Input
                  id="taxonomy-name"
                  required
                  autoFocus
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </Field>
              {isCat ? (
                <Field>
                  <FieldLabel>父分类</FieldLabel>
                  <Choice
                    label="父分类"
                    value={edit.parent_id ? String(edit.parent_id) : ROOT}
                    onValueChange={(value) =>
                      setEdit({
                        ...edit,
                        parent_id: value === ROOT ? null : Number(value),
                      })
                    }
                    options={[
                      { value: ROOT, label: "根分类" },
                      ...(data?.categories
                        .filter((c) => c.id !== edit.id)
                        .map((c) => ({ value: String(c.id), label: c.name })) ||
                        []),
                    ]}
                  />
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor="tag-kind">类型</FieldLabel>
                  <Input
                    id="tag-kind"
                    required
                    value={edit.kind}
                    onChange={(e) => setEdit({ ...edit, kind: e.target.value })}
                  />
                </Field>
              )}
              <Button type="submit">保存</Button>
            </FieldGroup>
          </form>
        </Modal>
      ) : null}
      {merge ? (
        <Modal title={`合并「${merge.name}」`} onClose={() => setMerge(null)}>
          <FieldGroup>
            <p className="text-sm">图片关联将转入目标分类，当前分类将被移除。</p>
            <Field>
              <FieldLabel>目标分类</FieldLabel>
              <Choice
                label="目标分类"
                value={target || NONE}
                onValueChange={(value) => setTarget(value === NONE ? "" : value)}
                options={[
                  { value: NONE, label: "选择分类" },
                  ...(data?.categories
                    .filter((c) => c.id !== merge.id)
                    .map((c) => ({ value: String(c.id), label: c.name })) || []),
                ]}
              />
            </Field>
            <Button
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
          </FieldGroup>
        </Modal>
      ) : null}
    </>
  );
}

export function Settings({ version, run }: { version: number; run: Run }) {
  const { data: d, error } = useData<any>("settings", {}, version);
  const readExif =
    d?.values?.find((x: any) => x.key === "read_exif")?.value === "true";
  return (
    <>
      <Heading
        eyebrow="MADE FOR YOUR WORKFLOW"
        title="设置"
        description="本地存储、隐私和运行状态。"
      />
      <ErrorBox error={error} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionTitle>存储与缓存</SectionTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">数据库</dt>
              <dd className="break-all">{d?.database || "—"}</dd>
              <dt className="text-muted-foreground">缩略图缓存</dt>
              <dd className="break-all">{d?.cache || "—"}</dd>
              <dt className="text-muted-foreground">缓存大小</dt>
              <dd>{bytes(d?.cache_bytes)}</dd>
            </dl>
            <Button
              variant="outline"
              onClick={() =>
                void run("cache_prune", {}, "已清理不再使用的缩略图")
              }
            >
              <Trash2 />
              清理未使用缓存
            </Button>
            <p className="text-xs leading-6 text-muted-foreground">
              备份时先关闭应用，再复制整个数据目录。可用 SORTNEST_DATA_DIR
              环境变量指定新存储目录；不会自动迁移旧库。
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <SectionTitle>隐私与资源</SectionTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field orientation="horizontal">
              <Field className="gap-1">
                <FieldLabel htmlFor="read-exif">读取 EXIF 元数据</FieldLabel>
                <FieldDescription>
                  可能包含拍摄设备和地理位置信息
                </FieldDescription>
              </Field>
              <Switch
                id="read-exif"
                aria-label="读取 EXIF 元数据"
                checked={readExif}
                onCheckedChange={(checked) =>
                  void run(
                    "settings_save",
                    { key: "read_exif", value: String(checked === true) },
                    "隐私设置已更新",
                  )
                }
              />
            </Field>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">模型请求并发</dt>
              <dd>1（串行，优先控制本机资源）</dd>
              <dt className="text-muted-foreground">图片解码并发</dt>
              <dd>1 · 单张解码内存上限 256 MB</dd>
              <dt className="text-muted-foreground">应用进程内存</dt>
              <dd>{bytes(d?.memory)}</dd>
              <dt className="text-muted-foreground">原图处理策略</dt>
              <dd>只读，不移动或修改</dd>
              <dt className="text-muted-foreground">HEIC / HEIF</dt>
              <dd>当前解码器不支持，将记录失败并继续扫描</dd>
              <dt className="text-muted-foreground">版本</dt>
              <dd>SortNest {d?.version || "0.1.0"}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
