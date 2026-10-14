# SortNest 实施与验收记录

日期：2026-10-09。依据工作区原始 `AGENT.MD` 开发；原文件和 `WeMM-Embedding-2B` 内容未修改。起始目录没有已有应用或 Git 仓库。

## 第一阶段：工程与 UI 基础

实际文件：`package.json`、`package-lock.json`、`tsconfig.json`、`vite.config.ts`、`index.html`、`src/main.tsx`、`src/App.tsx`、`src/components.tsx`、`src/styles.css`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/build.rs`、`src-tauri/tauri.conf.json`、`src-tauri/capabilities/default.json`、`src-tauri/icons/*`、`src-tauri/src/main.rs`、`lib.rs`、`db.rs`、`schema.sql`。

实现：Tauri 2 桌面窗口；React 导航与设计系统；SQLite WAL、外键、索引、迁移；统一 Tauri Command 调用；页面加载、空状态与错误反馈。

验证：前端生产构建、Rust 编译通过；数据库重复初始化和重启任务恢复测试通过。开发模式首次界面启动时遇到 Vite 初始化与重新加载问题，开发 CSP 和启动后重新加载已验证；发布版嵌入资源可独立启动，无需 Vite。

阶段后续：接入真实文件扫描和分页查询，不加入模拟数据。

## 第二阶段：文件夹扫描与数据库

实际文件：`src-tauri/src/scanner.rs`、`jobs.rs`、`api.rs`、`library.rs`、`integration_tests.rs`；`src/api.ts`、`src/Library.tsx`、`src/Management.tsx`、`src/components.tsx`。

实现：系统文件夹多选；递归流式扫描；重叠目录检查；不跟随链接；元数据、EXIF、方向校正、SHA-256、dHash、400px 缩略图；损坏文件错误记录；增量重扫；文件离线状态；后台任务串行队列、暂停、继续、取消；应用重启后恢复未完成任务。列表每页 120 条并虚拟化渲染。

验证：真实文件增量扫描、损坏文件隔离、删除文件状态更新测试通过；同大小同时间戳内容改变能使旧结果失效；取消扫描保留索引；移除目录保留所有原始文件。公开图片端到端扫描为 3 张成功、0 失败。

限制：HEIC/HEIF 无内置解码器，会记录失败；GIF 使用首帧。增量扫描由用户触发，不是常驻文件系统监听。扫描总量在遍历完成后确定，过程中不会显示虚假的剩余数量。

阶段后续：验证多提供商能力和嵌入兼容性。

## 第三阶段：多模型接入

实际文件：`src-tauri/src/models.rs`、`api.rs`、`jobs.rs`；`src/Management.tsx`；`services/wemm_server.py`、`services/requirements-lock.txt`、`environment.yml`、`scripts/start-model.ps1`。

实现：`ModelProvider` 抽象；Ollama `/api/tags`、`/api/embed`、`/api/chat`；OpenAI 兼容 `/models`、`/embeddings`、`/chat/completions`；本地 WeMM `/health`、`/embed`。支持读取已部署模型列表、配置 CRUD、连接/文本/图片/视觉测试、能力与维度记录、独立任务绑定、索引数量与失效数量。Windows 凭据管理器保存密钥，远程请求需用户启用。

验证：独立 Conda `sortnest` 环境创建并启动 WeMM CPU 服务；真实文本、图片输出均为 2048 维，L2 范数约 1；不兼容指纹、无效向量、不可达服务测试通过。标准 OpenAI embedding API 为文本接口，不伪造图片支持；请求格式参考官方文档 https://developers.openai.com/api/reference/resources/embeddings/methods/create 。

限制：没有用户提供的在线 Ollama 视觉模型或云端凭据，因此外部模型未做真实效果验收。兼容 API 已做本地 HTTP 契约测试，不能等同于所有第三方服务均已验证。云平台原生专用适配器没有为凑数量而添加。

阶段后续：将图片理解输出保存为可独立更新的描述、分类与标签。

## 第四阶段：分类与标签

实际文件：`src-tauri/src/library.rs`、`jobs.rs`、`integration_tests.rs`；`src/Detail.tsx`、`src/Management.tsx`、`src/Library.tsx`。

实现：可编辑多级分类；循环检查；分类合并、删除；主分类与辅助分类；标签类型、来源、时间、人工确认；图片多选批量增删标签与设置分类；描述手动编辑；AI JSON 输出校验与事务写入。描述变更独立使描述向量失效，更新标签不重新计算图片向量。AI 不覆盖已确认标签、用户分类和手动描述。

验证：分类循环拒绝，多标签统计按图片去重，过滤转义、层级筛选通过；HTTP 契约测试实际走能力测试→任务绑定→描述→分类标签→描述向量→查询→手动更正的数据库流程。真实 WeMM 测试库手动分类、标签、描述的保存和重新读取通过。

限制：WeMM 不能生成描述或标签；自动生成质量取决于另配的视觉模型。未将任意模型数字当作校准置信概率。

阶段后续：把经过验证的向量空间接到真实检索。

## 第五阶段：搜索与相似图片

实际文件：`src-tauri/src/models.rs`、`library.rs`、`integration_tests.rs`；`src/Library.tsx`、`src/Detail.tsx`；`scripts/prepare-fixtures.py`。

实现：关键词检索；跨模态文本→图片；描述语义检索；本地文件选择及图库图片→相似图片；Top K、目录/分类/标签/入库日期筛选；SHA-256 完全重复；dHash 视觉近似候选；原图查询预览、余弦分数、结果详情。向量紧凑存 SQLite BLOB，后台流式精确排序，保留有限候选。

真实模型验证：狗、宇航员、咖啡三张公开图片和三条中文查询均将对应图片排在第一位。直接服务测试余弦分数分别约 0.467、0.511、0.544；完整 Rust 流程也通过，详见 `artifacts/e2e-report.json`。该小样本验证了真实模型调用与链路，不能推断大规模检索质量。

限制：近似图片仅给出哈希候选，不能可靠断言是否经过缩放、压缩或风格变换；UI 分开标注。未对 10 万张图片的精确向量搜索做性能承诺。

阶段后续：真实仪表盘统计、发布构建与桌面验收。

## 第六阶段：可视化与产品化

实际文件：`src/Dashboard.tsx`、`src/App.tsx`、`src/Detail.tsx`、`src/Management.tsx`、`src/styles.css`、`src/api.test.ts`；`README.md`、`scripts/start-desktop.ps1`、`.gitignore`；上述 Rust 模块补充检查和测试。

实现：图片总数、元数据索引成功/待处理/失败、分类、标签、向量、重复副本、原图体积和任务状态；真实入库趋势、分类、Top 标签、格式、尺寸、状态图表；图表点击筛选；最近入库；设置页数据库/缓存位置、EXIF 隐私、缓存清理和进程内存；任务吞吐量及检索耗时。所有图表由 SQLite 查询生成。

验证：`npm run build`、`npm test`（2 项）、普通 Rust 测试（11 项）、真实模型端到端测试（单独执行 1 项）通过；Clippy 严格检查通过；npm 审计 0 项漏洞。Tauri 2 发布 exe 与 NSIS x64 安装包构建成功。Computer Use 实际检查了开发/发布窗口，空库及包含 3 张测试图片的仪表盘能显示真实统计。更多交互同时由后端集成测试覆盖。

已修复的失败：Windows 路径规范化导致增量复用失效、SQLite LIKE 转义、sysinfo 错误类型、开发 CSP、两个 Clippy 冗余返回警告、旧测试依赖安全问题。

桌面自动化在尝试导航图片库时多次返回“检测到用户输入”，因此没有继续争用桌面焦点；不将未完成的 UI 点击流程计为通过。图片扫描、检索、模型调用、分类标签与存储链路由上述真实模型端到端测试和 HTTP 契约测试验证。

## 当前边界

- 发布构建是可运行的 v0.1.0；尚未做代码签名和自动更新。
- 图片和模型请求串行处理，可暂停和排队；暂不提供并行推理设置。
- 模型请求超时上限 300 秒，取消后不写入结果；已发出的网络请求可能等待返回或超时，不能撤回已上传内容。
- 没有照片原文件删除功能，避免混淆移除索引与删除原图。
- 未接入大型 ANN 向量数据库，暂用 SQLite + Rust 精确搜索。
- 原始开发说明和本地模型文件保留，所有测试数据在 `artifacts`，正式库默认不导入测试图片。

后续优先事项：在用户真实图片库验证视觉模型的标签效果；测试大型图库性能；按实测结果增加解码器、任务并发、目录监听和专用向量索引。

最终回归补充：扫描恢复采用每次遍历独立的访问标记，保证重启前已见、重启后被删除的文件仍会标记为离线；同一任务 ID 再次遍历的回归测试通过。构建验证后停止了测试模型服务，释放 CPU 推理内存；正式使用时运行 `scripts/start-model.ps1`。

清理记录：最初为排查环境建立的 `.venv` 已不使用。清理命令被自动审批策略以 `blocked by policy` 拒绝，因此保留该目录；正式配置使用 Conda `sortnest`。

## UI 重构（2026-10-09）

采用 Ant Design 6.6.5，并通过 `ConfigProvider` 配置中文语言、主题色、控件尺寸、字体和圆角。导航改用 Menu，操作按钮、输入框、下拉列表、复选框、设置开关、弹窗、统计数字、空状态、加载和错误提示均使用组件库。`src/ui.tsx` 集中管理按钮语义和下拉选项适配，明确区分普通按钮与表单提交，保留数字 ID 到后端的原有转换。

重新整理全部页面的布局和样式：白色侧栏、浅灰工作区、绿色强调、较高文字对比度、统一间距；搜索与筛选支持窄窗口换行，模型表单可滚动，图片详情左右分栏，虚拟化图片行高度随卡片新尺寸同步调整。Rust 业务、SQLite 结构和模型服务协议不变。

用户提供的三层文件夹 Logo 原样备份为 `public/logo-original.png`，派生出侧栏/引导图、favicon 和多尺寸 Windows ICO。构建脚本补充图标文件变更监听，避免增量构建保留旧 Windows 图标。前端按 React、Ant Design、图表拆包，最大 JS 块约 454 kB。

验证：TypeScript 与生产构建通过；现有前端测试 2 项通过；Windows exe 和 NSIS x64 安装包成功构建。浏览器验证模型表单输入、切换到 WeMM 后地址及模型名称联动、保存按钮提交及错误提示；900×640 下搜索筛选布局正常、结果数可通过键盘切换。生产预览控制台未发现错误。使用独立测试库观察了真实桌面分类、模型管理和图片搜索页面；没有将浏览器无法连接 Tauri 的提示当作后端故障，也没有伪造图库数据。本轮没有重新运行耗时的真实模型端到端测试，前述模型测试记录属于首次实现阶段。

预览截图：`artifacts/SortNest-ui-preview.jpg`（浏览器界面预览）。交付目录：`release/`。

## 远程 HTTP 模型地址（2026-10-09）

按用户要求，移除 `src-tauri/src/models.rs` 中对非回环地址强制 HTTPS 的校验。Ollama 和 OpenAI 兼容配置可保存并使用 HTTP 或 HTTPS 地址，包含局域网 IP、端口与 API 路径；模型表单增加协议支持说明，README 同步更新。非回环服务的发送内容确认、URL 凭据/查询参数/片段校验、重定向策略及本地 WeMM 适配器范围沿用原行为。

验证：新增回归测试覆盖 HTTP IP、HTTP 域名、HTTPS 配置保存及重新读取、远程发送确认和非法 URL 拒绝。Rust 测试 13 项通过，真实 WeMM 端到端测试 1 项按默认配置忽略；Clippy 严格检查通过。未向用户的远程服务发起请求，实际服务连通性需在配置地址后使用应用内连接测试验证。

交付：前端生产构建、Windows 发布程序和 NSIS 安装包构建通过，已更新 `release/` 中的程序、安装包与 SHA-256 校验值。

## Ollama 图片嵌入适配（2026-10-09）

排查用户实际配置 `milkey/wemm-embedding-2b`：Ollama `/api/version` 返回 0.40.1；使用程序生成的 32×32 JPEG 调用多模态嵌入，服务返回 HTTP 501、`model does not support media embeddings`。没有上传用户图片、修改用户模型或切换任务绑定。该结果说明当前部署无法处理图片嵌入，不代表腾讯原始 WeMM 模型不支持图片。

同时确认旧适配器直接拒绝所有 Ollama 图片嵌入已不符合新版协议。根据官方 `api/types.go` 中 EmbedRequest 及 `server/routes.go` 的 EmbedHandler，实现 `/api/embed` 的 `input.image` Base64 请求与 `embeddings[0]` 响应；501 和 400 映射为明确的能力/协议提示。标准 OpenAI 兼容适配器继续使用文本嵌入协议。官方来源：https://github.com/ollama/ollama/blob/main/api/types.go 、https://github.com/ollama/ollama/blob/main/server/routes.go 。

Ollama 连接测试记录 `/api/tags` 的模型 digest，版本变化清除已验证能力并更新索引指纹；嵌入前核对 digest。跨模态检索接受经过文本与图片测试的同一 Ollama 配置、版本及匹配维度，不混用本地 WeMM 与 Ollama 的同名模型向量。模型管理和搜索说明同步更新。

新增 HTTP 契约测试验证图片字段、可解码 Base64、向量解析、跨模态边界、版本替换、501 和无效响应拒绝。首次回归发现连接失败未记录测试报告，已将版本探测纳入统一结果记录流程修复。成功响应的测试使用协议夹具，不能作为远程模型实际检索效果的证明；用户当前 Ollama 模型仍不支持 media embeddings，可继续使用已通过图片测试的本地 WeMM 配置。

最终验证：Rust 15 项测试通过、1 项真实 WeMM 测试忽略，Clippy 严格检查与前端生产构建通过，Windows exe 和 NSIS 安装包已更新到 `release/`，校验值同步更新。实际 Ollama 探测摘要保存在 `artifacts/ollama-media-validation.json`。

## 顶层 images 字段对照验证（2026-10-09）

根据用户提供的代码，使用其指定服务和 `milkey/wemm-embedding-2b`，保持 `input` 为 `Represent this image`，分别请求不带图片、狗、咖啡、宇航员图片，再重复不带图片请求。三个图像请求全部成功返回 2048 维向量，但每个元素均与纯文本请求完全相同：最大绝对差 0、余弦相似度 1.0，重复基线也完全相同。这说明当前部署的顶层 `images` 参数没有影响输出，成功返回向量不能作为图片嵌入可用的依据。没有据此替换应用的图片嵌入协议或标记图片能力通过。

新增可复现脚本 `scripts/check_ollama_image_input.py`，实测结果保存在 `artifacts/ollama-top-level-images-validation.json`。测试只使用既有公开样本图片，未读取或发送用户的 `test.jpg`，未更改用户数据库或模型配置。本轮只增加诊断脚本与记录，不涉及应用构建产物变更。


## 图片理解提示词与兼容响应修复（2026-10-09）

实际修改：`src/Management.tsx` 增加模型级多行提示词、输出上限（默认 4096、范围 256–32768）、模型卡片摘要，并允许 GIF/TIFF 能力测试。`src-tauri/src/db.rs` 以事务迁移 v1 到 v2，保留原配置，新增 vision_prompt/vision_max_tokens。`models.rs` 保存、验证设置，测试使用用户提示词；OpenAI 非流式请求支持字符串与 text/output_text 内容块，Ollama 使用 options.num_predict。截断、仅推理、拒绝、错误对象、Responses 协议和空正文均返回明确提示，不把推理或不完整正文保存为描述。失败测试清除旧样本和维度。

`jobs.rs` 将提示词接入描述任务，标签任务在偏好后追加结构化 JSON 约束。独立视觉任务指纹关联提示词和输出额度，修改后再次执行会刷新 AI 描述、标签；图片嵌入指纹保持不变，人工修改保留。描述更新继续使描述向量失效。新视觉指纹也会让旧版本 AI 描述/标签在下一次相应任务中重新生成，不会自动启动任务。

验证：18 项 Rust 测试通过，1 项真实 WeMM 测试默认忽略；2 项前端测试、TypeScript/生产构建和 Clippy 严格检查通过。新增测试覆盖旧库迁移、配置往返、能力失效范围、响应解析与错误分类；HTTP 契约集成测试验证自定义提示词及 8192 上限确实发送，并验证改词后重新生成描述、标签。迁移测试初次在旧连接读取 schema 缓存，调整为与应用一致的重新打开连接后通过。浏览器预览实际输入提示词和输出额度，截图检查发现字数提示与说明重叠，已去除冗余字数显示。

限制：未向用户 DeepSeek 服务发送图片，不能声称已复现或消除那条历史错误；新版会给出可操作的具体错误。HTTP 协议夹具用于验证客户端行为，不代表模型质量。浏览器预览没有 Tauri 数据库，保存与任务链路由上述 Rust 集成测试验证。GPU 环境安装仍保持用户要求的暂停状态，本轮没有继续修改或安装环境。

交付验证：最终 Windows exe 与 NSIS 安装包构建成功，已复制到 release/，SHA256SUMS.txt 同步更新。界面截图：artifacts/vision-prompt-settings.png（浏览器预览，仅检查输入和布局）。

## 嵌入模型替换为 EmbeddingGemma 2（2026-10-14）

本地嵌入从 WeMM-Embedding-2B 换成 EmbeddingGemma 2。`services/gemma_server.py` 用 SentenceTransformers 加载 `EmbeddingGemma-2`，只启用文本和视觉编码器，输出 768 维。查询使用 `SearchQuery` 前缀，描述索引使用 `Document` 前缀，图片不加前缀。CUDA 仅使用 bfloat16，不支持时使用 float32，禁止 float16。提供商标识改为 `embeddinggemma`。数据库版本 3 会把已保存的 WeMM 配置改到新提供商和模型名，并清空能力与版本指纹；旧向量因指纹不匹配而不再参与检索。图片嵌入上传最长边 1024 的 JPEG。Ollama 与 OpenAI 兼容路径保持原样。旧权重目录 `WeMM-Embedding-2B` 不再被启动脚本使用。

验证：Rust 库测试 22 项通过，真实端到端测试 1 项按默认忽略；前端测试 2 项通过，TypeScript 检查通过。Python 运行时测试 7 项通过。在 CPU、float32 上实际加载本地权重：文本与图片都返回 768 维单位向量。三张公开图片上，“一只白色的狗”“一杯咖啡”“穿着宇航服的宇航员”都把对应图片排在第一位，余弦约 0.717、0.730、0.725。单张图片 CPU 嵌入约 6.5 秒。Windows 发布程序和 NSIS 安装包已重新构建并复制到 `release/`，校验值已更新。Clippy 仍报告 `scanner.rs` 里原有的 dead_code、大枚举和参数个数告警，本次没有改该文件。没有在桌面窗口里点击模型表单。
