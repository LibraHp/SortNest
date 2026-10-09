import { Menu, Alert } from "antd";
import { Button } from "./ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  LayoutDashboard,
  Images,
  Search,
  ScanSearch,
  Folders,
  Tags,
  FolderTree,
  Boxes,
  Settings as SettingsIcon,
  ShieldCheck,
  ChevronRight,
  RefreshCw,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import Dashboard from "./Dashboard";
import Library from "./Library";
import Detail from "./Detail";
import {
  Folders as FolderPage,
  Models,
  Taxonomies,
  Settings,
  type Confirm,
} from "./Management";
import { Modal, type Run } from "./components";
import { api, desktop, type ImageItem, taskNames } from "./api";
const nav = [
  ["dashboard", "概览", LayoutDashboard],
  ["library", "图片库", Images],
  ["search", "语义搜索", Search],
  ["similar", "以图搜图", ScanSearch],
  ["categories", "分类浏览", FolderTree],
  ["tags", "标签管理", Tags],
  ["folders", "文件夹", Folders],
  ["models", "模型管理", Boxes],
  ["settings", "设置", SettingsIcon],
] as const;
export default function App() {
  const [page, setPage] = useState("dashboard"),
    [filter, setFilter] = useState<Record<string, unknown>>({}),
    [version, setVersion] = useState(0),
    [jobs, setJobs] = useState<any>(null),
    [detail, setDetail] = useState<ImageItem | null>(null),
    [seed, setSeed] = useState<ImageItem | null>(null),
    [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState<{
      message: string;
      error: boolean;
    } | null>(null),
    [busy, setBusy] = useState(0),
    [confirmation, setConfirmation] = useState<{
      title: string;
      body: string;
      action: () => Promise<void>;
    } | null>(null),
    [confirmBusy, setConfirmBusy] = useState(false);
  const previousJobs = useRef("");
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const run: Run = useCallback(
    async (operation, args = {}, success) => {
      setBusy((v) => v + 1);
      try {
        const value = await api(operation, args);
        if (success) setToast({ message: success, error: false });
        return value;
      } catch (e) {
        setToast({ message: String(e), error: true });
        return null;
      } finally {
        setBusy((v) => v - 1);
        refresh();
      }
    },
    [refresh],
  );
  useEffect(() => {
    let current = true;
    const poll = async () => {
      if (!desktop) return;
      try {
        const data = await api("jobs");
        if (!current) return;
        setJobs(data);
        const key = JSON.stringify(data.items);
        if (previousJobs.current && previousJobs.current !== key) refresh();
        previousJobs.current = key;
      } catch {
        /* surfaced on data pages */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (toast && !toast.error) {
      const t = setTimeout(() => setToast(null), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const navigate = useCallback((p: string, f: Record<string, unknown> = {}) => {
    setPage(p);
    setFilter(f);
    if (p !== "similar") setSeed(null);
  }, []);
  const confirm: Confirm = (title, body, action) =>
    setConfirmation({ title, body, action });
  const addFolder = async () => {
    try {
      const paths = await open({
        directory: true,
        multiple: true,
        title: "添加图片文件夹",
      });
      if (!paths) return;
      const folders = Array.isArray(paths) ? paths : [paths];
      for (const path of folders) {
        const result = await run("folder_add", { path }, "目录已添加");
        if (result)
          await run(
            "job_start",
            { kind: "scan", folder_id: result.id },
            "目录扫描已加入队列",
          );
      }
      navigate("folders");
    } catch (e) {
      setToast({ message: String(e), error: true });
    }
  };
  const active = jobs?.items?.find((j: any) =>
    ["running", "paused"].includes(j.status),
  );
  const currentTitle = nav.find((n) => n[0] === page)?.[1];
  return (
    <div className={`app ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => navigate("dashboard")}
          aria-label="SortNest 首页"
        >
          <img src="/logo.png" className="brand-logo" alt="" />
          <span>
            SortNest<small>本地图片工作空间</small>
          </span>
        </button>
        <div className="nav-label">工作空间</div>
        <nav aria-label="主导航">
          <Menu
            mode="inline"
            selectedKeys={[page]}
            inlineCollapsed={collapsed}
            onClick={({ key }) => navigate(key)}
            items={nav.flatMap(([id, label, Icon], index) => [
              ...(index === 6 ? [{ type: "divider" as const }] : []),
              { key: id, label, icon: <Icon size={19} /> },
            ])}
          />
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <ShieldCheck size={17} />
            <span>
              本地优先，安心收藏<small>原图只读 · 数据由你掌控</small>
            </span>
          </div>
          <button
            className="collapse-button"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
            <span>收起侧栏</span>
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>工作空间</span>
          <ChevronRight size={14} />
          <strong>{currentTitle}</strong>
          <div className="spacer" />
          {busy > 0 ? (
            <span className="working">
              <LoaderCircle size={14} className="spin" />
              正在处理
            </span>
          ) : (
            <span className="connection">
              <i />
              {desktop ? "本地数据库已连接" : "浏览器预览"}
            </span>
          )}
          <Button className="icon-button" title="刷新数据" onClick={refresh}>
            <RefreshCw size={16} />
          </Button>
          <span className="edition-badge">本地版</span>
        </header>
        {!desktop && (
          <div className="desktop-notice">
            这是界面预览。请运行 <code>npm run desktop</code>{" "}
            打开桌面应用，连接真实数据库和文件选择器。
          </div>
        )}
        <main key={page}>
          {page === "dashboard" ? (
            <Dashboard
              version={version}
              navigate={navigate}
              addFolder={() => void addFolder()}
              onOpen={setDetail}
            />
          ) : ["library", "search", "similar"].includes(page) ? (
            <Library
              key={page}
              version={version}
              filter={filter}
              run={run}
              onOpen={setDetail}
              searchPage={page === "search"}
              similarPage={page === "similar"}
              seed={seed}
            />
          ) : page === "folders" ? (
            <FolderPage
              version={version}
              run={run}
              confirm={confirm}
              addFolder={() => void addFolder()}
              jobs={jobs}
            />
          ) : page === "models" ? (
            <Models version={version} run={run} confirm={confirm} />
          ) : page === "categories" || page === "tags" ? (
            <Taxonomies
              mode={page}
              version={version}
              run={run}
              confirm={confirm}
              navigate={navigate}
            />
          ) : (
            <Settings version={version} run={run} />
          )}
          <footer className="app-footer">
            <span>SortNest · 图片有序，灵感自来</span>
            <span>LOCAL FIRST / ALWAYS YOURS</span>
          </footer>
        </main>
        {active && (
          <button className="task-dock" onClick={() => navigate("folders")}>
            <LoaderCircle
              className={active.status === "running" ? "spin" : ""}
              size={16}
            />
            <strong>
              {active.status === "paused"
                ? "任务已暂停"
                : active.kind === "scan"
                  ? "正在扫描图片"
                  : taskNames[active.task]}
            </strong>
            <span>
              {active.processed} 已处理 · {active.failed} 失败
            </span>
            <ChevronRight size={16} />
          </button>
        )}
      </div>
      {toast && (
        <div className="toast-container">
          <Alert
            title={toast.message}
            type={toast.error ? "error" : "success"}
            showIcon
            closable
            afterClose={() => setToast(null)}
          />
        </div>
      )}
      {detail && (
        <Detail
          image={detail}
          version={version}
          run={run}
          onClose={() => setDetail(null)}
          onSimilar={(i) => {
            setDetail(null);
            setSeed(i);
            setPage("similar");
            setFilter({});
          }}
        />
      )}
      {confirmation && (
        <Modal
          title={confirmation.title}
          onClose={() => !confirmBusy && setConfirmation(null)}
        >
          <div className="form-stack">
            <p>{confirmation.body}</p>
            <div className="modal-actions">
              <Button
                disabled={confirmBusy}
                onClick={() => setConfirmation(null)}
              >
                取消
              </Button>
              <Button
                className="danger solid"
                disabled={confirmBusy}
                onClick={() =>
                  void (async () => {
                    setConfirmBusy(true);
                    try {
                      await confirmation.action();
                      setConfirmation(null);
                    } finally {
                      setConfirmBusy(false);
                    }
                  })()
                }
              >
                {confirmBusy ? "正在执行…" : "确认操作"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
