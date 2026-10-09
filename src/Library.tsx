import { Button, Select, Input, Checkbox } from "./ui";
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Search,
  ImagePlus,
  SlidersHorizontal,
  X,
  ChevronLeft,
  ChevronRight,
  Plus,
  ScanLine,
  Copy,
} from "lucide-react";
import {
  api,
  asset,
  taskNames,
  type ImageItem,
  type Taxonomy,
  type Folder,
} from "./api";
import {
  useData,
  Heading,
  Empty,
  ImageGrid,
  ErrorBox,
  Loading,
  Modal,
  type Run,
} from "./components";

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
          similarPage
            ? "以图寻图"
            : searchPage
              ? "用一句话，找回灵感"
              : "图片库"
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
              onClick={() => update("duplicates", !filter.duplicates)}
              className={filter.duplicates ? "active" : ""}
            >
              <Copy size={16} />
              重复文件
            </Button>
          ) : undefined
        }
      />
      {searchingPage && (
        <section className="search-panel">
          <div className="search-mode">
            <label>
              检索方式
              <Select
                value={mode}
                onChange={(value) => {
                  setMode(value);
                  setResults(null);
                }}
              >
                {similarPage ? (
                  <>
                    <option value="image">图片向量 · 语义内容相关</option>
                    <option value="visual">感知哈希 · 视觉近似候选</option>
                    <option value="duplicate">SHA-256 · 完全重复</option>
                  </>
                ) : (
                  <>
                    <option value="semantic">跨模态 · 直接检索图片向量</option>
                    <option value="description">描述语义 · 检索描述向量</option>
                  </>
                )}
              </Select>
            </label>
            <label>
              结果数
              <Select
                value={String(filter.limit || 60)}
                onChange={(value) => update("limit", Number(value))}
              >
                <option>20</option>
                <option>60</option>
                <option>120</option>
              </Select>
            </label>
          </div>
          {similarPage ? (
            <div className="image-query">
              <button className="query-picker" onClick={() => void choose()}>
                <ImagePlus size={26} />
                <strong>
                  {path ? path.split(/[\\/]/).pop() : "选择一张本地图片"}
                </strong>
                <small>{path || "JPG、PNG、WebP 等常见格式"}</small>
              </button>
              {results?.query_path && (
                <img
                  className="query-preview"
                  src={asset(results.query_path)}
                  alt="查询图片"
                />
              )}
              <Button
                className="primary"
                disabled={!path || searching}
                onClick={() => void search()}
              >
                {searching ? "正在检索…" : "查找相似图片"}
                <Search size={17} />
              </Button>
            </div>
          ) : (
            <form
              className="semantic-input"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <Search size={21} />
              <Input
                aria-label="语义查询"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="试试描述：一只趴在沙发上的橘猫"
              />
              <Button
                type="submit"
                className="primary"
                disabled={!query.trim() || searching}
              >
                {searching ? "正在检索…" : "开始搜索"}
              </Button>
            </form>
          )}
          <p className="fine-print">
            {mode === "visual"
              ? "采用 dHash 汉明距离 ≤ 12 筛选候选。低纹理图片可能误匹配，不能据此自动认定为压缩或缩放副本。"
              : mode === "duplicate"
                ? "按文件 SHA-256 检测字节完全相同的文件。"
                : mode === "description"
                  ? "先生成图片描述，再运行描述向量索引；这是描述文本的语义检索。"
                  : "需要先测试模型能力并完成图片向量索引。跨模态检索要求同一 WeMM 或 Ollama 模型、版本及匹配的文本和图片向量维度。"}
          </p>
        </section>
      )}
      <div className="library-toolbar">
        {!searchingPage && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update("query", query);
            }}
            className="keyword-search"
          >
            <Search size={17} />
            <Input
              aria-label="关键词搜索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="按文件名、标签、描述搜索…"
            />
            <Button type="submit">搜索</Button>
          </form>
        )}
        <span className="result-count">
          {searchingPage
            ? results
              ? `${items.length} 个结果 · ${results.elapsed_ms} ms`
              : "等待检索"
            : `${data?.total ?? 0} 张图片`}
        </span>
        <div className="spacer" />
        <Button
          className={showFilters ? "active" : ""}
          onClick={() => setShowFilters(!showFilters)}
        >
          <SlidersHorizontal size={15} />
          筛选
        </Button>
        {!searchingPage && (
          <Select
            aria-label="排序"
            value={String(filter.sort || "newest")}
            onChange={(value) => update("sort", value)}
          >
            <option value="newest">最近入库</option>
            <option value="oldest">最早入库</option>
            <option value="name">名称排序</option>
            <option value="size">文件大小</option>
          </Select>
        )}
      </div>
      {showFilters && (
        <div className="filter-bar">
          <Select
            aria-label="目录筛选"
            value={String(filter.folder_id || "")}
            onChange={(value) => update("folder_id", Number(value))}
          >
            <option value="">全部目录</option>
            {folders?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.path}
              </option>
            ))}
          </Select>
          <Select
            aria-label="分类筛选"
            value={String(filter.category_id || "")}
            onChange={(value) => update("category_id", Number(value))}
          >
            <option value="">全部分类</option>
            {taxonomy?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="标签筛选"
            value={String(filter.tag_id || "")}
            onChange={(value) => update("tag_id", Number(value))}
          >
            <option value="">全部标签</option>
            {taxonomy?.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <label>
            入库起
            <Input
              type="date"
              value={String(filter.from || "")}
              onChange={(e) => update("from", e.target.value)}
            />
          </label>
          <label>
            至
            <Input
              type="date"
              value={String(filter.to || "")}
              onChange={(e) => update("to", e.target.value)}
            />
          </label>
          <Button
            onClick={() => {
              setFilter({});
              setPage(0);
              setQuery("");
              setResults(null);
            }}
          >
            <X size={15} />
            清空
          </Button>
        </div>
      )}
      {selected.size > 0 && (
        <div className="selection-bar">
          <strong>已选 {selected.size} 张</strong>
          <Button onClick={() => setBatch("add_tag")}>
            <Plus size={15} />
            添加标签
          </Button>
          <Button onClick={() => setBatch("remove_tag")}>移除标签</Button>
          <Button onClick={() => setBatch("category")}>设置主分类</Button>
          <Button onClick={() => setBatch("ai")}>
            <ScanLine size={15} />
            运行 AI 任务
          </Button>
          <Button
            className="link-button"
            onClick={() => setSelected(new Set())}
          >
            取消选择
          </Button>
        </div>
      )}
      <ErrorBox error={searchingPage ? searchError : error} />
      {!searchingPage && loading && !data ? (
        <Loading />
      ) : items.length ? (
        <>
          <div className="list-caption">
            {!searchingPage && (
              <label className="check-label">
                <Checkbox
                  checked={
                    items.length > 0 &&
                    items.every((i: ImageItem) => selected.has(i.id))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set(items.map((i: ImageItem) => i.id))
                        : new Set(),
                    )
                  }
                />
                选择本页
              </label>
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
        <Empty
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
        </Empty>
      )}
      {!searchingPage && (data?.total || 0) > 120 && (
        <div className="pagination">
          <Button
            disabled={page === 0}
            onClick={() => {
              setPage((p) => p - 1);
              setSelected(new Set());
            }}
          >
            <ChevronLeft size={16} />
            上一页
          </Button>
          <span>
            {page + 1} / {Math.ceil((data?.total || 0) / 120)}
          </span>
          <Button
            disabled={(page + 1) * 120 >= (data?.total || 0)}
            onClick={() => {
              setPage((p) => p + 1);
              setSelected(new Set());
            }}
          >
            下一页
            <ChevronRight size={16} />
          </Button>
        </div>
      )}
      {batch && (
        <Modal
          title={
            batch === "ai" ? "运行 AI 任务" : `批量修改 ${selected.size} 张图片`
          }
          onClose={() => setBatch("")}
        >
          <div className="form-stack">
            {batch === "add_tag" ? (
              <>
                <label>
                  标签名称
                  <Input
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    autoFocus
                  />
                </label>
                <label>
                  标签类型
                  <Input
                    value={tagKind}
                    onChange={(e) => setTagKind(e.target.value)}
                  />
                </label>
              </>
            ) : batch === "remove_tag" ? (
              <label>
                移除标签
                <Select
                  value={removeTag}
                  onChange={(value) => setRemoveTag(value)}
                >
                  <option value="">请选择标签</option>
                  {taxonomy?.tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : batch === "category" ? (
              <label>
                主分类
                <Select
                  value={category}
                  onChange={(value) => setCategory(value)}
                >
                  <option value="">请选择分类</option>
                  {taxonomy?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <label>
                任务类型
                <Select value={task} onChange={(value) => setTask(value)}>
                  {[
                    "image_embedding",
                    "description",
                    "tags",
                    "description_embedding",
                  ].map((k) => (
                    <option key={k} value={k}>
                      {taskNames[k]}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <Button className="primary" onClick={() => void submitBatch()}>
              确认执行
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
