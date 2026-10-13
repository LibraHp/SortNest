import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Copy,
  ImagePlus,
  Plus,
  ScanLine,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  ALL,
  Choice,
  EmptyState,
  ErrorBox,
  Heading,
  ImageGrid,
  Loading,
  Modal,
  useData,
  type Run,
} from "./components";
import {
  api,
  asset,
  taskNames,
  type Folder,
  type ImageItem,
  type Taxonomy,
} from "./api";

const tasks = [
  "image_embedding",
  "description",
  "tags",
  "description_embedding",
];

export default function Library({
  version,
  filter: initial,
  onOpen,
  run,
  searchPage = false,
  similarPage = false,
  seed,
}: {
  version: number;
  filter: Record<string, unknown>;
  onOpen: (i: ImageItem) => void;
  run: Run;
  searchPage?: boolean;
  similarPage?: boolean;
  seed?: ImageItem | null;
}) {
  const [filter, setFilter] = useState(initial),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Set<number>>(new Set()),
    [page, setPage] = useState(0),
    [showFilters, setShowFilters] = useState(false);
  const [mode, setMode] = useState(similarPage ? "image" : "semantic"),
    [path, setPath] = useState(""),
    [results, setResults] = useState<any>(null),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState("");
  const [batch, setBatch] = useState(""),
    [tag, setTag] = useState(""),
    [tagKind, setTagKind] = useState("主题"),
    [category, setCategory] = useState(""),
    [task, setTask] = useState("image_embedding"),
    [removeTag, setRemoveTag] = useState("");
  const { data, error, loading } = useData<{
    items: ImageItem[];
    total: number;
  }>("images", { ...filter, page, limit: 120 }, version);
  const { data: taxonomy } = useData<Taxonomy>("taxonomy", {}, version);
  const { data: folders } = useData<Folder[]>("folders", {}, version);
  useEffect(() => {
    setFilter(initial);
    setPage(0);
    setSelected(new Set());
  }, [initial]);
  useEffect(() => {
    if (seed) {
      setPath(seed.path);
      setMode("image");
      setResults(null);
    }
  }, [seed]);
  const searchingPage = searchPage || similarPage;
  const items = searchingPage ? results?.items || [] : data?.items || [];
  const update = (key: string, value: unknown) => {
    setPage(0);
    setSelected(new Set());
    setFilter((f) => ({ ...f, [key]: value }));
    setResults(null);
  };
  const search = async () => {
    setSearching(true);
    setSearchError("");
    try {
      setResults(
        await api("search", {
          ...filter,
          mode,
          query,
          path: similarPage ? path : undefined,
          image_id: similarPage && seed?.path === path ? seed.id : undefined,
          limit: Number(filter.limit) || 60,
        }),
      );
    } catch (e) {
      setResults(null);
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  };
  const choose = async () => {
    const p = await open({
      multiple: false,
      filters: [
        {
          name: "图片",
          extensions: [
            "jpg",
            "jpeg",
            "png",
            "webp",
            "gif",
            "bmp",
            "tif",
            "tiff",
          ],
        },
      ],
    });
    if (typeof p === "string") {
      setPath(p);
      setResults(null);
    }
  };
  const submitBatch = async () => {
    let value;
    if (batch === "ai")
      value = await run(
        "job_start",
        { kind: "ai", task, ids: [...selected] },
        "AI 任务已开始",
      );
    else
      value = await run(
        "batch",
        {
          ids: [...selected],
          action: batch,
          name: tag,
          kind: tagKind,
          category_id: Number(category),
          tag_id: Number(removeTag),
        },
        "修改已保存",
      );
    if (value) {
      setBatch("");
      setSelected(new Set());
    }
  };
  const pageCount = Math.ceil((data?.total || 0) / 120);
  const allSelected =
    items.length > 0 && items.every((i: ImageItem) => selected.has(i.id));
  return (
    <>
      <Heading
        eyebrow={
          similarPage
            ? "FIND THE CONNECTION"
            : searchPage
              ? "SEARCH BY MEANING"
              : "YOUR IMAGE LIBRARY"
        }
        title={
          similarPage ? "以图寻图" : searchPage ? "用一句话，找回灵感" : "图片库"
        }
        description={
          similarPage
            ? "分别查看语义相关、视觉接近与完全重复的图片。"
            : searchPage
              ? "搜索你记得的内容，让模型帮你找到那张图片。"
              : "每一份收藏，都值得被好好整理。"
        }
        actions={
          !searchingPage ? (
            <Button
              variant={filter.duplicates ? "default" : "outline"}
              onClick={() => update("duplicates", !filter.duplicates)}
            >
              <Copy />
              重复文件
            </Button>
          ) : undefined
        }
      />
      {searchingPage ? (
        <Card>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
              <Field>
                <FieldLabel>检索方式</FieldLabel>
                <Choice
                  label="检索方式"
                  value={mode}
                  onValueChange={(value) => {
                    setMode(value);
                    setResults(null);
                  }}
                  options={
                    similarPage
                      ? [
                          { value: "image", label: "图片向量 · 语义内容相关" },
                          { value: "visual", label: "感知哈希 · 视觉近似候选" },
                          { value: "duplicate", label: "SHA-256 · 完全重复" },
                        ]
                      : [
                          {
                            value: "semantic",
                            label: "跨模态 · 直接检索图片向量",
                          },
                          {
                            value: "description",
                            label: "描述语义 · 检索描述向量",
                          },
                        ]
                  }
                />
              </Field>
              <Field>
                <FieldLabel>结果数</FieldLabel>
                <Choice
                  label="结果数"
                  value={String(filter.limit || 60)}
                  onValueChange={(value) => update("limit", Number(value))}
                  options={[
                    { value: "20", label: "20" },
                    { value: "60", label: "60" },
                    { value: "120", label: "120" },
                  ]}
                />
              </Field>
            </div>
            {similarPage ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  className="h-auto min-w-64 flex-col items-start py-4"
                  onClick={() => void choose()}
                >
                  <ImagePlus />
                  <strong>
                    {path ? path.split(/[\\/]/).pop() : "选择一张本地图片"}
                  </strong>
                  <small className="font-normal text-muted-foreground">
                    {path || "JPG、PNG、WebP 等常见格式"}
                  </small>
                </Button>
                {results?.query_path ? (
                  <img
                    className="size-20 rounded-lg object-cover"
                    src={asset(results.query_path)}
                    alt="查询图片"
                  />
                ) : null}
                <Button disabled={!path || searching} onClick={() => void search()}>
                  {searching ? "正在检索…" : "查找相似图片"}
                  <Search />
                </Button>
              </div>
            ) : (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
              >
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="语义查询"
                    className="pl-8"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="试试描述：一只趴在沙发上的橘猫"
                  />
                </div>
                <Button type="submit" disabled={!query.trim() || searching}>
                  {searching ? "正在检索…" : "开始搜索"}
                </Button>
              </form>
            )}
            <p className="text-xs leading-6 text-muted-foreground">
              {mode === "visual"
                ? "采用 dHash 汉明距离 ≤ 12 筛选候选。低纹理图片可能误匹配，不能据此自动认定为压缩或缩放副本。"
                : mode === "duplicate"
                  ? "按文件 SHA-256 检测字节完全相同的文件。"
                  : mode === "description"
                    ? "先生成图片描述，再运行描述向量索引；这是描述文本的语义检索。"
                    : "需要先测试模型能力并完成图片向量索引。跨模态检索要求同一 WeMM 或 Ollama 模型、版本及匹配的文本和图片向量维度。"}
            </p>
          </CardContent>
        </Card>
      ) : null}
      <div className="flex flex-wrap items-center gap-4 rounded-xl bg-card p-3 ring-1 ring-border">
        {!searchingPage ? (
          <form
            className="flex min-w-64 flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              update("query", query);
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="关键词搜索"
                className="pl-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="按文件名、标签、描述搜索…"
              />
            </div>
            <Button type="submit" variant="secondary">
              搜索
            </Button>
          </form>
        ) : null}
        <span className="text-sm text-muted-foreground">
          {searchingPage
            ? results
              ? `${items.length} 个结果 · ${results.elapsed_ms} ms`
              : "等待检索"
            : `${data?.total ?? 0} 张图片`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant={showFilters ? "default" : "outline"}
            onClick={() => setShowFilters(!showFilters)}
          >
            <SlidersHorizontal />
            筛选
          </Button>
          {!searchingPage ? (
            <Choice
              label="排序"
              className="w-36"
              value={String(filter.sort || "newest")}
              onValueChange={(value) => update("sort", value)}
              options={[
                { value: "newest", label: "最近入库" },
                { value: "oldest", label: "最早入库" },
                { value: "name", label: "名称排序" },
                { value: "size", label: "文件大小" },
              ]}
            />
          ) : null}
        </div>
      </div>
      {showFilters ? (
        <Card>
          <CardContent className="grid gap-3 pt-6 md:grid-cols-3">
            <Choice
              label="目录筛选"
              value={filter.folder_id ? String(filter.folder_id) : ALL}
              onValueChange={(value) =>
                update("folder_id", value === ALL ? "" : Number(value))
              }
              options={[
                { value: ALL, label: "全部目录" },
                ...(folders?.map((f) => ({
                  value: String(f.id),
                  label: f.path,
                })) || []),
              ]}
            />
            <Choice
              label="分类筛选"
              value={filter.category_id ? String(filter.category_id) : ALL}
              onValueChange={(value) =>
                update("category_id", value === ALL ? "" : Number(value))
              }
              options={[
                { value: ALL, label: "全部分类" },
                ...(taxonomy?.categories.map((c) => ({
                  value: String(c.id),
                  label: c.name,
                })) || []),
              ]}
            />
            <Choice
              label="标签筛选"
              value={filter.tag_id ? String(filter.tag_id) : ALL}
              onValueChange={(value) =>
                update("tag_id", value === ALL ? "" : Number(value))
              }
              options={[
                { value: ALL, label: "全部标签" },
                ...(taxonomy?.tags.map((t) => ({
                  value: String(t.id),
                  label: t.name,
                })) || []),
              ]}
            />
            <Field>
              <FieldLabel htmlFor="from">入库起</FieldLabel>
              <Input
                id="from"
                type="date"
                value={String(filter.from || "")}
                onChange={(e) => update("from", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="to">至</FieldLabel>
              <Input
                id="to"
                type="date"
                value={String(filter.to || "")}
                onChange={(e) => update("to", e.target.value)}
              />
            </Field>
            <Button
              variant="outline"
              onClick={() => {
                setFilter({});
                setPage(0);
                setQuery("");
                setResults(null);
              }}
            >
              <X />
              清空
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-primary/5 px-3 py-2 ring-1 ring-primary/15">
          <strong className="text-sm">已选 {selected.size} 张</strong>
          <Button variant="outline" onClick={() => setBatch("add_tag")}>
            <Plus />
            添加标签
          </Button>
          <Button variant="outline" onClick={() => setBatch("remove_tag")}>
            移除标签
          </Button>
          <Button variant="outline" onClick={() => setBatch("category")}>
            设置主分类
          </Button>
          <Button variant="outline" onClick={() => setBatch("ai")}>
            <ScanLine />
            运行 AI 任务
          </Button>
          <Button variant="link" onClick={() => setSelected(new Set())}>
            取消选择
          </Button>
        </div>
      ) : null}
      <ErrorBox error={searchingPage ? searchError : error} />
      {!searchingPage && loading && !data ? (
        <Loading />
      ) : items.length ? (
        <>
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            {!searchingPage ? (
              <Field orientation="horizontal">
                <Checkbox
                  id="select-page"
                  checked={allSelected}
                  onCheckedChange={(checked) =>
                    setSelected(
                      checked === true
                        ? new Set(items.map((i: ImageItem) => i.id))
                        : new Set(),
                    )
                  }
                />
                <FieldLabel htmlFor="select-page">选择本页</FieldLabel>
              </Field>
            ) : (
              <span />
            )}
            <span>
              {searchingPage
                ? "余弦分数或哈希接近度不是置信概率"
                : "点击图片查看详情 · 勾选进行批量整理"}
            </span>
          </div>
          <ImageGrid
            items={items}
            onOpen={onOpen}
            selected={selected}
            onToggle={(id) =>
              setSelected((s) => {
                const v = new Set(s);
                if (v.has(id)) v.delete(id);
                else v.add(id);
                return v;
              })
            }
          />
        </>
      ) : (
        <EmptyState
          title={
            searchingPage
              ? results
                ? "没有找到匹配图片"
                : "从一次搜索开始"
              : "这里还没有匹配的图片"
          }
        >
          {searchingPage
            ? "先选择检索方式，再输入文字或选择图片。"
            : "添加文件夹并完成扫描，或调整当前筛选条件。"}
        </EmptyState>
      )}
      {!searchingPage && (data?.total || 0) > 120 ? (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                text="上一页"
                className={page === 0 ? "pointer-events-none opacity-50" : ""}
                onClick={(event) => {
                  event.preventDefault();
                  if (page === 0) return;
                  setPage((p) => p - 1);
                  setSelected(new Set());
                }}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-2 text-sm text-muted-foreground">
                {page + 1} / {pageCount}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                text="下一页"
                className={
                  (page + 1) * 120 >= (data?.total || 0)
                    ? "pointer-events-none opacity-50"
                    : ""
                }
                onClick={(event) => {
                  event.preventDefault();
                  if ((page + 1) * 120 >= (data?.total || 0)) return;
                  setPage((p) => p + 1);
                  setSelected(new Set());
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
      {batch ? (
        <Modal
          title={
            batch === "ai" ? "运行 AI 任务" : `批量修改 ${selected.size} 张图片`
          }
          onClose={() => setBatch("")}
        >
          <FieldGroup>
            {batch === "add_tag" ? (
              <>
                <Field>
                  <FieldLabel htmlFor="batch-tag">标签名称</FieldLabel>
                  <Input
                    id="batch-tag"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    autoFocus
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="batch-kind">标签类型</FieldLabel>
                  <Input
                    id="batch-kind"
                    value={tagKind}
                    onChange={(e) => setTagKind(e.target.value)}
                  />
                </Field>
              </>
            ) : batch === "remove_tag" ? (
              <Field>
                <FieldLabel>移除标签</FieldLabel>
                <Choice
                  label="移除标签"
                  value={removeTag || "none"}
                  onValueChange={(value) =>
                    setRemoveTag(value === "none" ? "" : value)
                  }
                  options={[
                    { value: "none", label: "请选择标签" },
                    ...(taxonomy?.tags.map((t) => ({
                      value: String(t.id),
                      label: t.name,
                    })) || []),
                  ]}
                />
              </Field>
            ) : batch === "category" ? (
              <Field>
                <FieldLabel>主分类</FieldLabel>
                <Choice
                  label="主分类"
                  value={category || "none"}
                  onValueChange={(value) =>
                    setCategory(value === "none" ? "" : value)
                  }
                  options={[
                    { value: "none", label: "请选择分类" },
                    ...(taxonomy?.categories.map((c) => ({
                      value: String(c.id),
                      label: c.name,
                    })) || []),
                  ]}
                />
              </Field>
            ) : (
              <Field>
                <FieldLabel>任务类型</FieldLabel>
                <Choice
                  label="任务类型"
                  value={task}
                  onValueChange={setTask}
                  options={tasks.map((key) => ({
                    value: key,
                    label: taskNames[key],
                  }))}
                />
              </Field>
            )}
            <Button onClick={() => void submitBatch()}>确认执行</Button>
          </FieldGroup>
        </Modal>
      ) : null}
    </>
  );
}
