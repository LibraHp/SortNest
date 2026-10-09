# SortNest

面向 Windows 的本地优先 AI 图片管理应用。Tauri 2 + Rust + React + TypeScript + SQLite。

界面使用 Ant Design 6，包含中文组件、统一绿色主题、可折叠菜单、表单、下拉选择、弹窗、状态提示和响应式布局。主题配置位于 `src/theme.ts`，布局样式位于 `src/styles.css`。品牌 Logo 已用于侧栏、首页引导、网页图标与 Windows 程序图标；原始图片副本保存在 `public/logo-original.png`。

## 启动

开发环境需要 Node.js 22+、Rust stable、Visual Studio C++ Build Tools 和 WebView2。

```powershell
npm ci
npm run desktop
```

发布构建：

```powershell
npm run package
```

应用：`src-tauri/target/release/sortnest.exe`。
安装包：`src-tauri/target/release/bundle/nsis/SortNest_0.1.0_x64-setup.exe`。

本次交付也在 `release/` 整理了 `SortNest.exe`、安装包、中文使用说明和 SHA-256 校验值，可直接使用。

`npm run dev` 仅用于网页界面开发，浏览器预览不会模拟数据库、文件选择或 AI 结果。实际功能请使用桌面应用。

## 本地 WeMM：使用 Conda

已有独立环境 `sortnest`，不会修改 base 环境。若在另一台电脑部署：

```powershell
conda env create -f environment.yml
conda activate sortnest
python -s services/wemm_server.py --model-dir ./WeMM-Embedding-2B --device cpu
```

也可使用 `./scripts/start-model.ps1`。`-s` 禁止加载用户级 Python 包，避免已有 Transformers / huggingface-hub 版本污染 Conda 环境。

模型权重沿用当前目录中的 `WeMM-Embedding-2B`，不随安装包打包，也不会自动下载。服务只监听 `127.0.0.1:8787`，默认离线加载模型，不接受任意文件路径、浏览器跨域调用或非本机访问。

当前电脑为 4GB 显存，默认 CPU 推理；2B 模型 float32 约需要 11GB 权重内存，并有额外运行开销。启动加载期间请耐心等待终端显示 `Uvicorn running`。CUDA 仅在安装了支持 CUDA 的 PyTorch 且显存足够时使用 `--device cuda`；4GB 显存不推荐。

模型管理配置：

| 字段 | 值 |
|---|---|
| 提供商 | 本地 WeMM |
| Base URL | `http://127.0.0.1:8787` |
| 模型名 | `WeMM-Embedding-2B` |
| API Key | 留空 |

先运行「连接」测试（自动记录权重版本指纹），再运行「文本」「图片嵌入」测试。通过后，将同一配置分配给图片嵌入和文本查询任务。

## 自定义图片理解

在「模型管理」中编辑 Ollama 或 OpenAI 兼容模型，可填写「图片理解提示词」并调整「图片理解输出上限」。提示词留空使用默认描述要求；默认输出上限为 4096 tokens，推理模型出现额度耗尽时可尝试 8192（须在服务支持范围内）。保存后重新运行「图片理解」测试，再分配图片描述或分类标签任务。

提示词用于测试与描述任务，标签任务参考其内容偏好并追加必需的分类标签 JSON 约束。修改这些设置后，重新运行任务会刷新原有 AI 结果，保留人工修改；不使图片向量失效。描述实际更新后，需重新生成描述向量才能用于描述语义检索。GIF 只读取单帧。

兼容接口现在支持字符串正文与文本内容块，并区分输出被截断、只有推理内容、拒绝回答、响应协议不匹配及空正文。不会把 reasoning/thinking 字段当作描述，也不会将已截断的正文保存为成功结果。对服务真实不支持的图片输入，修改提示词无法替代模型能力。

## 完整工作流

1. 添加本地图片目录，可多选。目录扫描依次排队；扫描不跟随符号链接，不修改原图。
2. 在图片库浏览缩略图，点击图片查看原图、EXIF、描述、标签和向量状态。
3. 配置并测试模型，分别指定图片嵌入、文本嵌入、描述、分类标签模型。
4. 在文件夹页运行全库 AI 任务，或在图片库多选后运行选中图片的任务。
5. 图片向量建立后，可用中文语义搜索或以图搜图；也可不配置 AI，直接使用文件名/标签/描述关键词搜索和重复检测。
6. 新增、修改、移动或删除图片后，点击重新扫描。未变化图片复用索引；已离线图片不计入有效库。

**WeMM 只生成嵌入，不生成描述和标签。** 自动描述、分类和标签需要另配支持图片输入的 Ollama 或 OpenAI 兼容视觉模型。保存模型并不意味着能力已验证；必须实际通过对应测试。

Ollama 图片嵌入使用新版 `/api/embed` 的 `input: {"image": "<base64>"}` 格式。服务版本和模型必须共同支持 media embeddings；文本嵌入通过、模型名称包含 WeMM、或支持图片对话，都不能代替图片嵌入测试。先运行「连接」记录模型 digest，再运行「文本」「图片嵌入」。服务返回 HTTP 501 时会提示当前模型不支持图片嵌入，不会将其标记为可用。标准 OpenAI `/embeddings` 仍按文本协议使用。

### 检索方式

| 模式 | 实现与要求 |
|---|---|
| 关键词 | 文件名、标签、描述的 SQLite 匹配；不调用模型 |
| 跨模态语义 | 使用通过文本及图片嵌入测试的同一 WeMM 或 Ollama 模型、服务、版本与匹配维度，余弦排序 |
| 描述语义 | 描述文本向量与查询文本来自同一嵌入模型；先生成描述，再建立描述索引 |
| 图片向量检索 | 查询图片与图库使用同一模型配置，返回内容相关图片 |
| 完全重复 | SHA-256 相同，表示文件字节完全相同 |
| 视觉近似候选 | dHash 汉明距离 ≤ 12；不是经过校准的置信度，需人工核对 |

相同向量维度不代表空间兼容。模型、地址或版本变化会使旧向量被排除；WeMM 在响应中核对权重版本，Ollama 在嵌入请求前核对 `/api/tags` 的 digest。版本变化后重新进行连接、能力测试和索引。对于 OpenAI 兼容 API 的可变模型别名，更新远端权重后请修改「模型版本 / 配置标识」。能力测试验证接口与向量有效性，检索效果仍需用实际图片和查询评估。

感知哈希不能可靠区分“压缩/缩放副本”与“构图接近”，应用明确标注为候选，不会自动删除图片。

## 数据与安全

- 数据库默认在 Windows 应用数据目录 `com.sortnest.desktop/sortnest.sqlite3`；准确路径见设置页。
- 可通过 `SORTNEST_DATA_DIR` 指定数据目录。更换目录不会自动迁移旧库；备份时先关闭应用，再复制整个数据目录。
- SQLite WAL、外键、唯一约束、事务和版本化迁移；未完成任务重启后进入暂停状态，由用户继续或取消。
- 同时只运行一个后台任务、一次解码和一次模型请求。扫描流式遍历，图片库每页 120 张并虚拟化显示。
- 原图只读，移除目录只删除索引。界面中的分类、标签和模型删除需要确认。
- API Key 使用 Windows 凭据管理器保存，不存 SQLite 或日志；界面只显示是否存在密钥。
- Ollama 和 OpenAI 兼容服务支持 HTTP / HTTPS，可填写局域网 IP 或远程域名；非回环服务仍需勾选允许发送文本和图片内容，远程重定向禁用。本地 WeMM 适配器仅连接回环地址。
- 缩略图及预览仅对已添加目录开放资产协议。上传模型的是后台生成的最大 1024px JPEG，不反复经前端传 Base64。
- 目录预览授权在当前应用会话内保留，便于移除后重新添加；重启后仅恢复仍在索引中的目录授权。
- EXIF 可关闭；关闭会立即移除已存 EXIF。原始图片本身仍可能带有 EXIF，但发送模型的 JPEG 会重新编码。
- 单张图片解码限制为 256MB、最大边长 32768；超限及损坏文件单独记录错误。
- 普通 JPG/PNG/WebP/GIF/BMP/TIFF 可用。GIF 预览采用首帧。HEIC/HEIF 尚无解码器，记录失败并继续处理其他文件。

## 验证

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

真实 WeMM 端到端测试需先启动本地模型服务，并执行 `python -s scripts/prepare-fixtures.py` 下载三张公开图片：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml real_wemm_end_to_end -- --ignored --nocapture
```

测试数据单独存于 `artifacts/e2e-data`，不影响正式库；报告输出 `artifacts/e2e-report.json`。常规测试不依赖网络或真实模型。UI 不内置任何演示图片或虚假统计数据。

## 代码位置

| 路径 | 职责 |
|---|---|
| `src-tauri/src/api.rs` | Tauri 命令分发与管理操作 |
| `src-tauri/src/schema.sql`, `db.rs` | SQLite 数据模型、迁移、连接 |
| `src-tauri/src/scanner.rs` | 路径、元数据、解码、缩略图、增量扫描 |
| `src-tauri/src/models.rs` | 提供商抽象、凭据、能力验证、向量空间 |
| `src-tauri/src/jobs.rs` | 任务队列、恢复、图片描述/分类/标签/向量持久化 |
| `src-tauri/src/library.rs` | 分类标签、筛选、搜索、统计 |
| `src/App.tsx`, `src/*.tsx` | 导航、图表、虚拟化网格、详情、管理页面 |
| `services/wemm_server.py` | 可选本地 WeMM 推理服务 |

开发阶段记录、验收证据和限制见 [IMPLEMENTATION.md](IMPLEMENTATION.md)。
