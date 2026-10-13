import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  Boxes,
  ChevronRight,
  FolderTree,
  Folders,
  Images,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ScanSearch,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Tags,
  Info,
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
import { type Run } from "./components";
import { api, desktop, type ImageItem, taskNames } from "./api";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";

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

const DashboardView = memo(Dashboard);
const LibraryView = memo(Library);
const FolderView = memo(FolderPage);
const ModelsView = memo(Models);
const TaxonomiesView = memo(Taxonomies);
const SettingsView = memo(Settings);

function CollapseButton() {
  const { toggleSidebar, state } = useSidebar();
  const collapsed = state === "collapsed";
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={toggleSidebar}
          tooltip={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          <span>收起侧栏</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export default function App() {
  const [page, setPage] = useState("dashboard"),
    [filter, setFilter] = useState<Record<string, unknown>>({}),
    [version, setVersion] = useState(0),
    [jobs, setJobs] = useState<any>(null),
    [detail, setDetail] = useState<ImageItem | null>(null),
    [seed, setSeed] = useState<ImageItem | null>(null);
  const [busy, setBusy] = useState(0),
    [confirmation, setConfirmation] = useState<{
      title: string;
      body: string;
      action: () => Promise<void>;
    } | null>(null),
    [confirmBusy, setConfirmBusy] = useState(false);
  const previousJobs = useRef("");
  const previousStatuses = useRef("");
  const lastPageRefresh = useRef(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const run: Run = useCallback(
    async (operation, args = {}, success) => {
      setBusy((v) => v + 1);
      try {
        const value = await api(operation, args);
        if (success) toast.success(success, { duration: 4500 });
        return value;
      } catch (e) {
        toast.error(String(e), { duration: Number.POSITIVE_INFINITY });
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
        const items = data.items ?? [];
        const key = items
          .map(
            (job: { id: string; status: string; processed: number; failed: number }) =>
              `${job.id}:${job.status}:${job.processed}:${job.failed}`,
          )
          .join("|");
        const errors = JSON.stringify(data.errors ?? []);
        const signature = `${key}#${errors}`;
        if (signature === previousJobs.current) return;
        const hadJobs = previousJobs.current !== "";
        previousJobs.current = signature;
        setJobs(data);
        if (!hadJobs) return;
        const statuses = items
          .map((job: { status: string }) => job.status)
          .join("|");
        const now = Date.now();
        if (
          statuses !== previousStatuses.current ||
          now - lastPageRefresh.current > 8000
        ) {
          previousStatuses.current = statuses;
          lastPageRefresh.current = now;
          refresh();
        }
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
  const navigate = useCallback((p: string, f: Record<string, unknown> = {}) => {
    setPage(p);
    setFilter(f);
    if (p !== "similar") setSeed(null);
  }, []);
  const confirm: Confirm = useCallback(
    (title, body, action) => setConfirmation({ title, body, action }),
    [],
  );
  const addFolder = useCallback(async () => {
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
      toast.error(String(e), { duration: Number.POSITIVE_INFINITY });
    }
  }, [navigate, run]);
  const active = jobs?.items?.find((j: any) =>
    ["running", "paused"].includes(j.status),
  );
  const currentTitle = nav.find((n) => n[0] === page)?.[1];
  const workspace = nav.slice(0, 6);
  const manage = nav.slice(6);
  return (
    <SidebarProvider
      className="h-svh overflow-hidden"
      style={{ "--sidebar-width": "17rem" } as CSSProperties}
    >
      <Sidebar collapsible="icon" className="border-r border-border/80">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                tooltip="SortNest"
                onClick={() => navigate("dashboard")}
                aria-label="SortNest 首页"
              >
                <img src="/logo.png" alt="" className="size-8 rounded-md object-contain" />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-[15px] font-semibold tracking-tight">
                    SortNest
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    本地图片工作空间
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>工作空间</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {workspace.map(([id, label, Icon]) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      className="h-10 rounded-lg"
                      isActive={page === id}
                      tooltip={label}
                      onClick={() => navigate(id)}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupLabel>管理</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {manage.map(([id, label, Icon]) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      className="h-10 rounded-lg"
                      isActive={page === id}
                      tooltip={label}
                      onClick={() => navigate(id)}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="px-2 pb-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            <div className="flex items-center gap-2 text-foreground/80">
              <ShieldCheck className="size-4 text-primary" />
              本地优先
            </div>
            <p className="mt-1 pl-6 leading-5">原图只读，数据留在这台电脑</p>
          </div>
          <CollapseButton />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border/70 bg-background px-8">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <span className="text-muted-foreground">工作空间</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator>
                <ChevronRight />
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                <BreadcrumbPage>{currentTitle}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {busy > 0 ? (
                <Spinner />
              ) : (
                <span className="size-1.5 rounded-full bg-primary" />
              )}
              {busy > 0
                ? "正在处理"
                : desktop
                  ? "本地数据库已连接"
                  : "浏览器预览"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              title="刷新数据"
              onClick={refresh}
            >
              <RefreshCw />
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-10 px-10 py-10">
            {!desktop ? (
              <Alert>
                <Info />
                <AlertTitle>这是界面预览</AlertTitle>
                <AlertDescription>
                  请运行 <code>npm run desktop</code>{" "}
                  打开桌面应用，连接真实数据库和文件选择器。
                </AlertDescription>
              </Alert>
            ) : null}
            <div key={page} className="flex flex-col gap-10">
              {page === "dashboard" ? (
                <DashboardView
                  version={version}
                  navigate={navigate}
                  addFolder={addFolder}
                  onOpen={setDetail}
                />
              ) : ["library", "search", "similar"].includes(page) ? (
                <LibraryView
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
                <FolderView
                  version={version}
                  run={run}
                  confirm={confirm}
                  addFolder={addFolder}
                  jobs={jobs}
                />
              ) : page === "models" ? (
                <ModelsView version={version} run={run} confirm={confirm} />
              ) : page === "categories" || page === "tags" ? (
                <TaxonomiesView
                  mode={page}
                  version={version}
                  run={run}
                  confirm={confirm}
                  navigate={navigate}
                />
              ) : (
                <SettingsView version={version} run={run} />
              )}
              <footer className="flex items-center justify-between border-t border-border/70 pt-5 text-[11px] tracking-wide text-muted-foreground">
                <span>SortNest · 图片有序，灵感自来</span>
                <span>LOCAL FIRST / ALWAYS YOURS</span>
              </footer>
            </div>
          </div>
        </div>
        {active ? (
          <Button
            variant="outline"
            className="absolute bottom-5 left-1/2 z-20 h-10 -translate-x-1/2 gap-3 rounded-full bg-card px-4 shadow-lg ring-1 ring-border"
            onClick={() => navigate("folders")}
          >
            <Spinner className={active.status === "running" ? "" : "animate-none"} />
            <strong>
              {active.status === "paused"
                ? "任务已暂停"
                : active.kind === "scan"
                  ? "正在扫描图片"
                  : taskNames[active.task]}
            </strong>
            <span className="text-muted-foreground">
              {active.processed} 已处理 · {active.failed} 失败
            </span>
            <ChevronRight />
          </Button>
        ) : null}
      </SidebarInset>
      {detail ? (
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
      ) : null}
      <AlertDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !confirmBusy) setConfirmation(null);
        }}
      >
        <AlertDialogContent className="max-h-[70vh] w-[min(32rem,90vw)] max-w-[min(32rem,90vw)] overflow-y-auto sm:max-w-[min(32rem,90vw)]">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={confirmBusy}
              onClick={(event) => {
                event.preventDefault();
                void (async () => {
                  if (!confirmation) return;
                  setConfirmBusy(true);
                  try {
                    await confirmation.action();
                    setConfirmation(null);
                  } finally {
                    setConfirmBusy(false);
                  }
                })();
              }}
            >
              {confirmBusy ? "正在执行…" : "确认操作"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
