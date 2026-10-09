import { Statistic } from "antd";
import { Button } from "./ui";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  ArrowUpRight,
  FolderPlus,
  Images,
  ScanLine,
  Tags,
  HardDrive,
  Copy,
  CheckCircle2,
  Clock3,
  TriangleAlert,
} from "lucide-react";
import {
  useData,
  Empty,
  Heading,
  ErrorBox,
  Loading,
  SectionTitle,
} from "./components";
import { asset, bytes, statusNames, type ImageItem } from "./api";
const colors = [
  "#277d6b",
  "#8eb6a1",
  "#e9bb78",
  "#7598b5",
  "#bab0d2",
  "#d68f7d",
];
export default function Dashboard({
  version,
  navigate,
  addFolder,
  onOpen,
}: {
  version: number;
  navigate: (page: string, filter?: Record<string, unknown>) => void;
  addFolder: () => void;
  onOpen: (i: ImageItem) => void;
}) {
  const { data: d, error, loading } = useData<any>("dashboard", {}, version);
  if (loading && !d) return <Loading />;
  const m = d?.metrics || {};
  const charts = [
    ["分类分布", "categories", "category_id"],
    ["常用标签", "tags", "tag_id"],
    ["图片格式", "formats", "extension"],
    ["分辨率分布", "sizes", ""],
    ["索引状态", "states", "status"],
  ];
  return (
    <>
      <Heading
        eyebrow="YOUR CREATIVE SPACE"
        title="图片有序，灵感自来。"
        description="整理珍藏，找回灵感。你的图片资产，一目了然。"
        actions={
          <Button className="primary" onClick={addFolder}>
            <FolderPlus size={17} />
            添加文件夹
          </Button>
        }
      />
      <ErrorBox error={error} />
      <div className="metrics">
        {[
          [Images, "图片总数", m.total],
          [ScanLine, "已完成索引", m.indexed],
          [Tags, "已分类", m.classified],
          [HardDrive, "图片库占用", bytes(m.bytes)],
        ].map(([Icon, label, value]: any) => (
          <div className="metric" key={label}>
            <div className="metric-label">
              {label}
              <Icon size={18} />
            </div>
            <Statistic value={value ?? "—"} />
            <span>
              {label === "已分类"
                ? "按图片去重统计"
                : label === "已完成索引"
                  ? "元数据与缩略图已就绪"
                  : label === "图片库占用"
                    ? "原始图片文件大小"
                    : "当前有效索引中的图片"}
            </span>
          </div>
        ))}
      </div>
      <div className="mini-metrics">
        {[
          [Clock3, "待索引", m.pending],
          [TriangleAlert, "索引失败", m.failed],
          [CheckCircle2, "已有向量", m.embedded],
          [Tags, "已有标签", m.tagged],
          [Copy, "重复副本", d?.duplicates?.count],
        ].map(([Icon, label, value]: any) => (
          <button
            key={label}
            onClick={() =>
              navigate(
                "library",
                label === "重复副本"
                  ? { duplicates: true }
                  : label === "索引失败"
                    ? { status: "failed" }
                    : {},
              )
            }
          >
            <Icon size={15} />
            {label}
            <b>{value ?? "—"}</b>
          </button>
        ))}
      </div>
      {!error && m.total === 0 ? (
        <div className="welcome-panel">
          <img className="welcome-logo" src="/logo.png" alt="SortNest" />
          <div>
            <span className="eyebrow">从一个文件夹开始</span>
            <h2>让散落的图片，成为有序的灵感库</h2>
            <p>
              添加本地目录，自动读取图片信息并生成缩略图。
              <br />
              随后配置 AI 模型，开启分类、标签与语义搜索。
            </p>
            <Button className="primary" onClick={addFolder}>
              导入第一个文件夹
              <ArrowUpRight size={17} />
            </Button>
          </div>
          <span className="local-note">原图留在原处 · 默认不上传</span>
        </div>
      ) : null}
      <div className="dashboard-grid">
        <section className="panel trend-panel">
          <SectionTitle>
            图片入库趋势<span className="sub-label">最近 30 个入库日期</span>
          </SectionTitle>
          {d?.trend?.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart
                data={d.trend}
                margin={{ top: 15, right: 16, left: -22, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#277d6b" stopOpacity={0.19} />
                    <stop offset="100%" stopColor="#277d6b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="#e8ece9"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="value"
                  name="新增图片"
                  stroke="#277d6b"
                  fill="url(#area)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty title="等待第一次入库">
              添加文件夹后，入库趋势将在这里显示。
            </Empty>
          )}
        </section>
        <section className="panel library-health">
          <SectionTitle>下一步，整理你的灵感</SectionTitle>
          <button onClick={() => navigate("folders")}>
            <span className="step">01</span>
            <div>
              <strong>连接图片文件夹</strong>
              <p>增量扫描，让新图片自动归档</p>
            </div>
            <ArrowUpRight size={17} />
          </button>
          <button onClick={() => navigate("models")}>
            <span className="step">02</span>
            <div>
              <strong>配置你的 AI 助手</strong>
              <p>按任务选择模型，验证真实能力</p>
            </div>
            <ArrowUpRight size={17} />
          </button>
          <button onClick={() => navigate("search")}>
            <span className="step">03</span>
            <div>
              <strong>用一句话找回图片</strong>
              <p>跨模态与描述语义检索</p>
            </div>
            <ArrowUpRight size={17} />
          </button>
        </section>
      </div>
      <div className="chart-grid">
        {charts.map(([title, key, filter]) => (
          <section className="panel" key={key}>
            <SectionTitle>{title}</SectionTitle>
            {d?.[key]?.length ? (
              <ResponsiveContainer width="100%" height={205}>
                {key === "formats" || key === "states" ? (
                  <PieChart>
                    <Pie
                      data={d[key].map((x: any) => ({
                        ...x,
                        name: statusNames[x.name] || x.name,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={73}
                      paddingAngle={3}
                      onClick={(_, index) =>
                        filter &&
                        navigate("library", {
                          [filter]: d[key][index].filter || d[key][index].name,
                        })
                      }
                    >
                      {d[key].map((_: any, i: number) => (
                        <Cell key={i} fill={colors[i % colors.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend iconType="circle" iconSize={8} />
                  </PieChart>
                ) : (
                  <BarChart
                    data={d[key]}
                    layout="vertical"
                    margin={{ left: 4, right: 20 }}
                  >
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={85}
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip cursor={{ fill: "#f2f5f3" }} />
                    <Bar
                      dataKey="value"
                      name="图片数"
                      fill="#83aa96"
                      radius={[0, 4, 4, 0]}
                      maxBarSize={18}
                      onClick={(v: any) =>
                        filter && navigate("library", { [filter]: v.id })
                      }
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            ) : (
              <Empty title="暂无统计数据">完成相关索引后自动更新</Empty>
            )}
          </section>
        ))}
      </div>
      <p className="fine-print">
        分类和标签按关联统计，一张图片可有多个分类与标签；重复副本为每组 SHA-256
        相同文件数减一。向量完成与元数据索引完成分别统计。
      </p>
      <SectionTitle action="查看全部" onAction={() => navigate("library")}>
        最近入库
      </SectionTitle>
      {d?.recent?.length ? (
        <div className="recent-grid">
          {d.recent.map((i: ImageItem) => (
            <button key={i.id} onClick={() => onOpen(i)}>
              <img src={asset(i.thumbnail)} alt={i.name} />
              <span>{i.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="quiet-empty">你的新图片会出现在这里。</div>
      )}
    </>
  );
}
