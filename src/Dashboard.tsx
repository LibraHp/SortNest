import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Copy,
  FolderPlus,
  HardDrive,
  Images,
  ScanLine,
  Tags,
  TriangleAlert,
} from "lucide-react";
import {
  EmptyState,
  ErrorBox,
  Heading,
  Loading,
  SectionTitle,
  useData,
} from "./components";
import { asset, bytes, statusNames, type ImageItem } from "./api";

const palette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const trendConfig = {
  value: { label: "新增图片", color: "var(--chart-1)" },
} satisfies ChartConfig;
const countConfig = {
  value: { label: "图片数", color: "var(--chart-2)" },
} satisfies ChartConfig;

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
          <Button onClick={addFolder}>
            <FolderPlus />
            添加文件夹
          </Button>
        }
      />
      <ErrorBox error={error} />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [Images, "图片总数", m.total, "当前有效索引中的图片"],
          [ScanLine, "已完成索引", m.indexed, "元数据与缩略图已就绪"],
          [Tags, "已分类", m.classified, "按图片去重统计"],
          [HardDrive, "图片库占用", bytes(m.bytes), "原始图片文件大小"],
        ].map(([Icon, label, value, hint]: any) => (
          <Card key={label} size="sm">
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{label}</span>
                <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
              </div>
              <p className="text-3xl font-semibold tracking-tight tabular-nums">
                {value ?? "—"}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          [Clock3, "待索引", m.pending, {}],
          [TriangleAlert, "索引失败", m.failed, { status: "failed" }],
          [CheckCircle2, "已有向量", m.embedded, {}],
          [Tags, "已有标签", m.tagged, {}],
          [Copy, "重复副本", d?.duplicates?.count, { duplicates: true }],
        ].map(([Icon, label, value, next]: any) => (
          <Button
            key={label}
            variant="ghost"
            className="h-9 rounded-full bg-card px-3 ring-1 ring-border hover:bg-accent"
            onClick={() => navigate("library", next)}
          >
            <Icon />
            {label}
            <span className="font-semibold tabular-nums">{value ?? "—"}</span>
          </Button>
        ))}
      </div>
      {!error && m.total === 0 ? (
        <Card className="items-center gap-8 bg-gradient-to-br from-card to-primary/5 p-8 md:flex-row">
          <img
            className="size-24 object-contain"
            src="/logo.png"
            alt="SortNest"
          />
          <div className="max-w-lg space-y-3">
            <p className="text-[11px] font-medium tracking-[0.18em] text-primary/80">
              从一个文件夹开始
            </p>
            <h2 className="text-xl font-semibold tracking-tight">
              让散落的图片，成为有序的灵感库
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              添加本地目录，自动读取图片信息并生成缩略图。随后配置 AI
              模型，开启分类、标签与语义搜索。
            </p>
            <Button onClick={addFolder}>
              导入第一个文件夹
              <ArrowUpRight />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground md:ml-auto md:self-end">
            原图留在原处 · 默认不上传
          </p>
        </Card>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
        <Card>
          <CardHeader>
            <SectionTitle>
              图片入库趋势
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                最近 30 个入库日期
              </span>
            </SectionTitle>
          </CardHeader>
          <CardContent>
            {d?.trend?.length ? (
              <ChartContainer
                config={trendConfig}
                className="aspect-auto h-[220px] w-full"
              >
                <AreaChart
                  data={d.trend}
                  margin={{ top: 15, right: 16, left: -22, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} />
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
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="value"
                    stroke="var(--color-value)"
                    fill="var(--color-value)"
                    fillOpacity={0.2}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <EmptyState title="等待第一次入库">
                添加文件夹后，入库趋势将在这里显示。
              </EmptyState>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <SectionTitle>下一步，整理你的灵感</SectionTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {[
              ["01", "folders", "连接图片文件夹", "增量扫描，让新图片自动归档"],
              ["02", "models", "配置你的 AI 助手", "按任务选择模型，验证真实能力"],
              ["03", "search", "用一句话找回图片", "跨模态与描述语义检索"],
            ].map(([step, target, title, body]) => (
              <Button
                key={step}
                variant="ghost"
                className="h-auto justify-start gap-3 rounded-xl px-2 py-3"
                onClick={() => navigate(target)}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {step}
                </span>
                <span className="grid flex-1 text-left">
                  <strong>{title}</strong>
                  <span className="text-xs font-normal text-muted-foreground">
                    {body}
                  </span>
                </span>
                <ArrowUpRight />
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {charts.map(([title, key, filter]) => {
          const rows = (d?.[key] || []).map((item: any) => ({
            ...item,
            name: statusNames[item.name] || item.name,
          }));
          const pie = key === "formats" || key === "states";
          const config = Object.fromEntries(
            rows.map((item: any, index: number) => [
              item.name,
              { label: item.name, color: palette[index % palette.length] },
            ]),
          ) satisfies ChartConfig;
          return (
            <Card key={key}>
              <CardHeader>
                <SectionTitle>{title}</SectionTitle>
              </CardHeader>
              <CardContent>
                {rows.length ? (
                  <ChartContainer
                    config={pie ? config : countConfig}
                    className="aspect-auto h-[205px] w-full"
                  >
                    {pie ? (
                      <PieChart>
                        <Pie
                          isAnimationActive={false}
                          data={rows}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={48}
                          outerRadius={73}
                          paddingAngle={3}
                          onClick={(_, index) =>
                            filter &&
                            navigate("library", {
                              [filter]:
                                d[key][index].filter || d[key][index].name,
                            })
                          }
                        >
                          {rows.map((item: any, index: number) => (
                            <Cell
                              key={item.name}
                              fill={palette[index % palette.length]}
                            />
                          ))}
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <ChartLegend content={<ChartLegendContent />} />
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
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar
                          isAnimationActive={false}
                          dataKey="value"
                          fill="var(--color-value)"
                          radius={[0, 4, 4, 0]}
                          maxBarSize={18}
                          onClick={(item: any) =>
                            filter && navigate("library", { [filter]: item.id })
                          }
                        />
                      </BarChart>
                    )}
                  </ChartContainer>
                ) : (
                  <EmptyState title="暂无统计数据">
                    完成相关索引后自动更新
                  </EmptyState>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        分类和标签按关联统计，一张图片可有多个分类与标签；重复副本为每组 SHA-256
        相同文件数减一。向量完成与元数据索引完成分别统计。
      </p>
      <SectionTitle action="查看全部" onAction={() => navigate("library")}>
        最近入库
      </SectionTitle>
      {d?.recent?.length ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {d.recent.map((i: ImageItem) => (
            <Button
              key={i.id}
              variant="outline"
              className="h-auto flex-col items-stretch overflow-hidden rounded-xl p-0"
              onClick={() => onOpen(i)}
            >
              <img
                src={asset(i.thumbnail)}
                alt={i.name}
                className="h-36 w-full object-cover"
              />
              <span className="truncate px-2 py-2 text-left text-xs">
                {i.name}
              </span>
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">你的新图片会出现在这里。</p>
      )}
    </>
  );
}
