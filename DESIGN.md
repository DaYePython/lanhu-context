# lanhu-context-cli 架构设计

> 从 lanhu-context-mcp 升级而来、专为 CLI 与 AI 自动化设计的工具。
> 遵循 UNIX 原则：每个命令只做一件事、可组合、可管道化、机器可读。
> 技术栈：TypeScript + pnpm monorepo + Vite（library/SSR 模式构建）。

---

## 1. 上游调研结论（lanhu-context-mcp）

设计依据来自对 `lanhu-context-mcp` 源码的完整调研，关键事实：

### 1.1 端到端数据链路

```text
蓝湖设计稿（已转码上传）
  → 完整详情 URL: https://lanhuapp.com/web/#/item/project/detailDetach?tid=...&pid=...&image_id=...
  → parseLanhuUrl(url) 解析 hash fragment → { teamId(tid), projectId(pid|project_id), docId(image_id|docId) }
  → 主站 API  GET /api/project/image        (含 dds_status=1) → 设计稿元数据：name / 预览 URL / projectName / versions[].json_url
  → 主站 API  GET /api/project/multi_info    (img_limit=500, detach=1) → 按 imageId 找 latest_version → versionId
  → DDS API   GET /api/dds/image/store_schema_revise?version_id=... → data_resource_url → GET 得到 DDS schema JSON
  → schema-to-html: DDS schema → HTML+CSS（COMMON_CSS flex 工具类 + 每节点 class）
      ├─ localizeImageUrls: OSS 图片 URL → 本地路径（icon-1/icon-2 顺序名）+ curl 下载映射
      └─ 可选 css-to-tailwind: v3/v4 引擎转换，无法映射的 class 保留，异常回退原 HTML
  → 主站 versions[0].json_url → Sketch JSON → extractDesignTokens（高风险视觉 token：渐变/边框/圆角/阴影/透明度）
  → downloadImage(design.url) → preview.png Buffer
  → 组装 content: [HTML代码, 图片映射(curl), Design Tokens, 实现指引 Guide, 预览图 base64]
  → inline 模式直接返回 / files 模式落盘 <outDir>/<设计稿名>-<imageId前8位>/{context.md, preview.png}
```

### 1.2 关键机制

| 机制 | 事实 |
| --- | --- |
| **Token 本质** | `LANHU_TOKEN` 是浏览器请求头中的**整段 Cookie**（会过期的登录凭证），不是 OAuth token。主站 client 放入 `Cookie` header；DDS client 用 `DDS_TOKEN`（缺省复用 LANHU_TOKEN）+ 固定 `Authorization: Basic dW5kZWZpbmVkOg==`，且两个 client 都伪装浏览器 UA/Referer/sec-ch-ua |
| **业务错误形态** | 蓝湖对无效 token / 无权限 / 设计稿不存在返回 **HTTP 200 + null payload**（`unwrapEnvelope` 靠 `result`/`data` 为空判定失败，附带 `code`/`msg`） |
| **配置优先级** | CLI flag > 已存在环境变量 > env 文件（`--env-path`/`--env-file` > `ENV_FILE` > cwd 的 `.env.local`）> 默认值；`--cwd` 在 env 加载前 chdir，同时影响凭据文件与输出目录 |
| **config.ts CLI 定义** | 基于 `cleye`：`contextFlags`（lanhuToken/ddsToken/httpTimeout/tailwindcss/twVersion/skipSlices/unitScale/promptLang/envFile/envPath/cwd/outDir）+ server 专属（stdio/http/host/port/mode）；唯一子命令 `export <url>`（带 `--inline`），无子命令时启动 MCP server |
| **错误策略** | "停止，不猜测、不降级"：URL、元数据、schema→HTML、Tokens、预览图任一失败都整体抛错并附 STOP 指令；**tokens/preview 这类可选阶段的失败也会导致全盘失败**（CLI 版要改进的点） |
| **输出通道** | `export` 默认 stdout 打文件摘要；`--inline` 时 stdout 打完整 context 正文、摘要转 stderr（已有管道意识，但输出非结构化） |
| **已知限制** | 目录名清理不含 Windows 保留字符；imageId 截 8 位防重名；`.local` 后缀目录利用常见 gitignore 约定；unitScale 是全局倍率；inline 大稿易撑爆客户端上限 |

### 1.3 从 MCP 到 CLI 要解决的问题

1. **单体命令**：只有一个 `export` 复合命令，中间产物（schema、tokens、切图映射）无法单独获取，无法组合。
2. **输出非结构化**：成功摘要是自由文本，AI/脚本只能靠猜路径；无 `--json`。
3. **错误无分级**：所有失败一律 `process.exit(1)` + 文本，退出码不可区分，可选阶段失败连带核心产物丢失。
4. **切图不落地**：只给 curl 映射文本，下载动作丢给下游 AI 逐条执行。
5. **凭据管理原始**：只有 env 文件/flag，无 `auth` 子命令、无 token 活性检测。

---

## 2. 定位与设计目标

**lanhu-context-cli 是一个"设计稿上下文管道工具箱"**：把蓝湖设计稿 URL 按阶段拆成一组可独立调用、可管道组合的小命令，默认输出机器可读结构，为 AI Agent（skills 调度）与 shell 自动化优化，同时保留一条 MCP 兼容通道。

设计原则映射（对应需求中的 7 条 CLI 原则）：

| 原则 | 落地方式 |
| --- | --- |
| 明确命令与操作 | 每阶段一个动词命令：`parse`/`meta`/`schema`/`html`/`tokens`/`assets`/`preview`/`context` |
| 结构化输出 | stdout 只放数据；`--json` 统一 envelope；批量场景 NDJSON |
| 可操作错误信息 | 结构化错误 `{code, severity, message, hint}`，每个 code 附修复建议 |
| 非交互自动化 | 无 TTY 时零交互；所有输入可 flag/env/stdin 提供（凭据走 `auth set --token-stdin`）；无确认式交互——覆盖等动作以显式 `--force` 表达意图，不设 `--yes` |
| 安全与幂等 | 导出/下载默认幂等（内容寻址跳过已存在）；`--dry-run`；无破坏性命令；token 永不回显 |
| 帮助与文档 | 每个命令 `--help` 含示例；`lanhu help pipeline` 讲组合用法 |
| 分级严重性 | 三级严重性（fatal / degraded / notice）+ 分类退出码，详见 §6 |

---

## 3. Monorepo 架构

```text
lanhu-context-cli/
├── pnpm-workspace.yaml
├── package.json                 # 根：脚本编排、工具链
├── tsconfig.base.json
├── vitest.workspace.ts
├── packages/
│   ├── core/                    # @lanhu-context/core —— 纯逻辑，零 CLI/MCP 依赖
│   │   └── src/
│   │       ├── url/             # parseLanhuUrl（沿用别名规则 pid|project_id, image_id|docId）
│   │       ├── api/             # LanhuClient（fetch/ofetch 重写 axios）：meta / versionId / ddsSchema / sketchJson / image
│   │       ├── transform/       # schema→html、css-helpers、css→tailwind(v3/v4)、tokens 提取
│   │       ├── pipeline/        # 各阶段的编排函数：每阶段独立导出 + composeContext() 复合
│   │       ├── errors.ts        # LanhuError { code, severity, hint, retryable } + 错误码表
│   │       └── types/           # LanhuUrlParams / SchemaNode / DesignMeta / StageResult ...
│   ├── cli/                     # lanhu-context-cli —— bin: `lanhu`
│   │   └── src/
│   │       ├── commands/        # 一命令一文件：parse/meta/schema/html/tokens/assets/preview/context/auth/doctor/mcp
│   │       ├── io/              # stdout 数据写出（json/md/html/css 格式器）、stderr 诊断、NDJSON、TTY 检测
│   │       ├── config/          # c12 加载 lanhu.config + env + flags 合并，凭据解析
│   │       └── exit.ts          # severity/code → 退出码映射
│   └── mcp/                     # @lanhu-context/mcp —— MCP 兼容层（预留）
│       └── src/                 # 复用 core.composeContext；注册 get_design_context，保持与 lanhu-context-mcp 工具签名兼容
├── skills/
│   └── lanhu-cli/               # AI Agent 调度技能（见 §8）
│       ├── SKILL.md
│       └── references/
├── playground/                  # 真实 URL 的手动验证场景
└── docs/
```

**依赖方向**：`cli → core`、`mcp → core`；`core` 不依赖任何终端/协议库，保证三端（CLI、MCP、未来 API）共享同一实现。

**构建**：每个 package 用 Vite library 模式（`build.ssr: true`，target node20，external node 内建模块与 dependencies）；开发期 `vite-node` 直跑 TS；测试 vitest（沿用上游的单测 + `RUN_INTEGRATION=1` 集成测试分层）。

**版本与发布**：使用 **changesets**（`@changesets/cli`）管理 monorepo 版本——workspace 内部依赖用 `workspace:^` 协议，`changeset version` 统一升版并回写依赖，`changeset publish` 发布；`core`/`cli` 为公开包（publishConfig.access public），占位阶段的 `mcp` 保持 private 由 changesets 自动忽略。根脚本：`changeset` / `version-packages` / `release`。

**建议依赖选型**（与 Vite 同生态，优先 unjs 系）：

| 用途 | 选型 | 理由 |
| --- | --- | --- |
| 命令行框架 | `citty` | 子命令树 + 类型化 args；比 cleye 更适合多命令；备选 commander |
| 配置加载 | `c12` | 支持 `lanhu.config.ts`/rc/env 分层合并，天然匹配 §7 优先级 |
| HTTP | `ofetch`（或原生 fetch + 薄封装） | 去掉 axios 重依赖；拦截器实现 Cookie 注入与 envelope 解包 |
| 校验 | `zod` | 沿用上游；schema 即文档 |
| 终端输出 | `consola`（stderr）+ `picocolors` | consola 天然区分数据/日志通道，支持 `--json` 静默 |
| Tailwind 转换 | `css-to-tailwindcss` / `css-to-tailwindcss4` | 沿用上游，已验证 |
| env | `dotenv` | 兼容既有 `.env.local` 习惯 |

---

## 4. 命令设计

bin 名建议注册两个：`lanhu`（日常）与 `lanhu-context`（防冲突全名）。

### 4.1 命令总览

| 命令 | 职责（一件事） | stdout 输出 |
| --- | --- | --- |
| `lanhu parse <url\|->` | URL → 三元组 ID | `{teamId, projectId, imageId}` |
| `lanhu meta <url>` | 设计稿元数据 | `{name, projectName, imageId, previewUrl, versions}` |
| `lanhu schema <url>` | 原始 DDS schema | schema JSON（喂给 `html -`） |
| `lanhu html <url\|->` | schema → HTML/CSS（或 Tailwind） | HTML 文本 |
| `lanhu tokens <url>` | Design Tokens 提取 | JSON / CSS variables（`--format css`） |
| `lanhu assets <url>` | 切图映射；`--download` 时并发下载 | 映射 JSON；下载报告 |
| `lanhu preview <url>` | 预览图 | `-o <file>` 落盘 + stdout 报告；`-o -` 直出 PNG 二进制 |
| `lanhu context <url>` | 复合命令 = 上游 `export`：一次产出 context.md + preview.png | 文件清单 JSON（`--inline` 时为 context 正文） |
| `lanhu auth <set\|status\|test>` | 凭据管理与活性检测 | 状态 JSON（永不含 token 明文） |
| `lanhu doctor` | 环境自检（node 版本/网络/token/cwd 可写） | 检查报告 |
| `lanhu mcp [--stdio\|--http]` | 启动 MCP 兼容 server | （协议流） |

原子命令（parse→preview）对应管道各阶段，`context` 是官方组合的快捷复合命令——既满足"一步出结果"，又不牺牲可组合性。

### 4.2 全局 flags

```text
--token <string>        LANHU_TOKEN（优先用 env/auth，避免进 shell 历史）
--dds-token <string>    DDS_TOKEN，缺省复用 --token
--timeout <ms>          HTTP 超时，默认 30000
--retries <n>           仅对 retryable 错误重试的次数，默认 2（指数退避，见 §6.3）
--env-file <path>       env 文件，默认 cwd/.env.local（保留 --env-path 别名兼容 Node 20/22）
--cwd <path>            工作目录锚点（先于 env 加载与相对路径解析）
--json                  结构化 envelope 输出（报告类命令无 TTY 时自动开启；产物流命令见 §5 通道规则）
--format <fmt>          按命令支持 json|md|html|css|table
-o, --output <path|->   写文件或 stdout（显式 -o 声明的产物通道不受自动 --json 影响，见 §5）
--stdin                 批处理模式：从 stdin 逐行读 URL/NDJSON，逐条输出 NDJSON 结果
--force                 跳过内容比对，强制重写全部产物文件（默认：内容一致跳过、不一致覆盖）
-q, --quiet             stderr 只留 error
--verbose               stderr 输出 debug（含各阶段耗时）
--no-color              禁用颜色（NO_COLOR env 亦生效）
--strict                warning 升级为 fatal（CI 用）
--keep-going            批量模式下单条失败不中断（部分失败整体退出码 9，见 §6.2）
--dry-run               只报告将执行的动作、不写盘（支持：context、assets --download、preview -o <file>）
--lang <en-US|zh-CN>    指引文本语言（上游 --prompt-lang 更名，保留别名）
--version               输出版本；与 --json 组合输出 {name, version, node}
```

命令级 flags：

| 命令 | flag | 说明 |
| --- | --- | --- |
| `html` / `context` | `--tailwind` | CSS→Tailwind 转换（上游 `--tailwindcss` 简化，保留别名） |
| `html` / `context` | `--tw-version <3\|4>` | Tailwind 引擎版本 |
| `html` / `context` | `--unit-scale <n>` | 全局尺寸倍率 |
| `html` / `context` | `--skip-slices` | 跳过切图定位与映射 |
| `html` / `context` | `--assets-dir <path>` | 映射中的本地图片路径前缀 |
| `context` | `--inline` | stdout 直接输出 context 正文（与 `--json` 互斥，见 §5） |
| `context` | `--out-dir <path>` | 落盘目录，默认 `<cwd>/.lanhu.local` |
| `assets` | `--download` | 实际下载切图（默认只输出映射） |
| `assets` | `--concurrency <n>` | 并发下载数，默认 4 |
| `auth set` | `--token-stdin` | 从 stdin 读 token，避免进 argv/shell 历史 |
| `mcp` | `--stdio` / `--http` / `--host` / `--port` / `--mode` / `--compat-strict` | 见 §9 |

### 4.3 输入约定

- 记法约定：`<x>` 必选、`[x]` 可选、`-` 表示从 stdin 读；批处理模式（`--stdin`）下省略位置参数。
- 位置参数接受**完整 URL、纯 query 串（`tid=..&pid=..&image_id=..`）或 `-`（stdin）**，与上游 parseLanhuUrl 的三形态一致。
- stdin 支持两种：单个 URL/schema JSON（配合 `-`）；**多行 URL / NDJSON 批量**（`--stdin` 批处理模式，逐条输出 NDJSON 结果）。
- 所有命令在无 TTY 时不发起任何交互。

### 4.4 管道组合示例

```bash
# 阶段拆解：schema 落盘复查 → 离线转 HTML（不重复请求蓝湖）
lanhu schema "$URL" > page.schema.json
lanhu html - --tailwind --tw-version 4 < page.schema.json > page.html

# 只取 ID 给别的脚本
lanhu parse "$URL" --json | jq -r .data.imageId

# 提取 tokens 直接生成 CSS 变量文件
lanhu tokens "$URL" --format css > src/styles/design-tokens.css

# 下载全部切图到项目资产目录（幂等：已存在且内容 hash 一致则跳过）
lanhu assets "$URL" --download -o src/assets/lanhu --concurrency 4

# 批量导出一个项目的多张设计稿
cat urls.txt | lanhu context --stdin --keep-going --out-dir .lanhu --json > report.ndjson

# 一步到位（等价上游 export --inline）
lanhu context "$URL" --inline | claude -p "按 context 实现这个页面"
```

---

## 5. 输出契约

**通道纪律（UNIX）**：stdout 只承载数据/产物；进度、日志走 stderr。`--json` 模式下，成功与失败的 envelope 都是待消费的"数据"，统一走 stdout——失败的第一信号永远是非零退出码，下游不需要同时监听两个流。这保证任何命令都可安全 `>` 与 `|`。

命令按 stdout 内容分两类，`--json` 的自动开启规则不同：

| 类别 | 命令 | stdout 行为 |
| --- | --- | --- |
| **报告类** | `parse` `meta` `assets` `context` `auth` `doctor` | 输出本身是结构数据：`--json` 输出 envelope，**无 TTY 时自动开启** |
| **产物流** | `schema` `html` `tokens` `preview` `context --inline` | stdout 即产物本体（schema JSON / HTML / tokens / PNG / context 正文），**无论有无 TTY 都原样输出**，保证 §4.4 管道与重定向稳定；显式传 `--json` 才改为 envelope（产物入 `data`） |

产物流的两条边界规则：

- 显式 `-o` 声明的通道优先：`-o <file>` 落盘后 stdout 输出报告 envelope；`-o -` 将产物写入 stdout，此时不输出 envelope（状态由退出码 + stderr 表达）。自动 `--json` 不改变已由 `-o` 显式声明的产物通道。
- 二进制产物与 envelope 不混流：`preview --json` 必须配 `-o <file>`；`preview --json -o -` 与 `context --inline --json` 均为用法错误（exit 2）。

### 5.1 结构化 envelope（`--json`）

成功（stdout）：

```json
{
  "ok": true,
  "command": "context",
  "data": {
    "designName": "首页-数据大屏",
    "imageId": "a1b2c3d4-...",
    "files": [
      { "path": "/abs/.lanhu/首页-数据大屏-a1b2c3d4/context.md", "type": "context", "bytes": 48213 },
      { "path": "/abs/.lanhu/首页-数据大屏-a1b2c3d4/preview.png", "type": "preview", "bytes": 231044 }
    ],
    "assets": { "total": 12, "downloaded": 0, "mappingIncluded": true }
  },
  "warnings": [
    { "code": "TOKENS_UNAVAILABLE", "severity": "degraded", "message": "Sketch JSON 缺少 json_url，已跳过 Design Tokens", "hint": "如需 tokens，确认设计稿版本已在蓝湖完成转码" }
  ],
  "meta": { "version": "0.1.0", "durationMs": 2314 }
}
```

失败（同样走 stdout，以非零退出码为第一信号；stderr 保留人类可读诊断）：

```json
{
  "ok": false,
  "command": "context",
  "error": {
    "code": "AUTH_EXPIRED",
    "severity": "fatal",
    "message": "蓝湖 API /api/project/image 返回空 result (code=401)",
    "hint": "Token 是浏览器 Cookie 整段且会过期：重新登录蓝湖复制 Cookie，运行 `lanhu auth set` 更新后用 `lanhu auth test` 验证",
    "retryable": false
  }
}
```

- 人类模式（TTY 且未指定 `--json`）：stdout 输出同样数据的可读排版，错误与警告经 consola 彩色输出到 stderr；两种模式数据字段一一对应。
- 批处理（`--stdin`）：stdout 逐条 NDJSON，成功与失败条目都是完整 envelope + `input` 回显字段——与单条 `--json` 的通道语义完全一致；stderr 输出汇总 `{total, ok, failed}`。整体退出码：全成功 0，部分失败 9，全失败取主导错误类别码（§6.2）。

### 5.2 幂等与安全

- `context`/`assets --download` 重复执行结果一致：同名文件按**内容 hash** 比对（不用文件大小，避免同大小不同内容误跳过），一致则跳过、不一致则覆盖，`--force` 跳过比对强制重写；报告中区分 `written/skipped/overwritten`。
- 没有删除类命令；输出目录固定在 `--out-dir`（默认 `<cwd>/.lanhu.local`，沿用 `.local` gitignore 约定）之下，不触碰目录外文件。
- Token 永不出现在 stdout/stderr/产物文件/错误信息中（`auth status` 只显示来源与掩码指纹）。

---

## 6. 分级严重性处理

上游 MCP"任一阶段失败 → 全盘 STOP"对协议场景合理，但对 CLI 是过度阻塞：预览图 404 不应吞掉已生成的 HTML。CLI 按**产物必要性**分三级：

### 6.1 严重性层级

| 级别 | 定义 | 行为 | 例子 |
| --- | --- | --- | --- |
| **fatal（致命阻塞）** | 核心产物无法产出 | 立即停止，非零退出，错误 envelope 按 §5 通道规则输出（`--json` → stdout；人类模式 → stderr 可读诊断），附 hint | URL 缺 tid/pid/image_id；token 缺失/过期；schema 拉取失败；schema→HTML 转换失败；输出目录不可写 |
| **degraded（低效摩擦）** | 核心产物 OK，附属阶段失败或质量降级 | 继续执行，退出码 0，`warnings[]` 记录；`--strict` 下升级为 fatal | tokens 提取失败；预览图下载失败；Tailwind 转换回退原 HTML；部分切图下载失败（报告逐条列出） |
| **notice（可优化项）** | 不影响本次结果的改进建议 | 仅 `--verbose`/人类模式提示 | 未显式指定 `--unit-scale` 而设计稿疑似 2x；目录名含 Windows 保留字符；inline 输出超过 200KB 建议 files 模式 |

各命令的"核心产物"不同，容错策略随命令而变：`schema` 的核心是 schema 本身（拉不到即 fatal）；`context` 的核心是 context.md 的 HTML 部分（tokens/preview 皆可降级）；`assets --download` 单张失败默认记 warning 继续，`--strict` 时首败即停。

### 6.2 退出码分类

| 退出码 | 类别 | 触发 |
| --- | --- | --- |
| 0 | 成功（允许携带 warnings） | |
| 1 | 未知/内部错误 | 未分类异常（bug） |
| 2 | 用法错误 | 参数非法、URL 解析失败（`URL_MISSING_TID` 等） |
| 3 | 配置/凭据缺失 | token 未提供、env 文件不存在、`--cwd` 无效 |
| 4 | 认证/权限失败 | token 过期、无团队/项目权限、API 空 result（`AUTH_EXPIRED` / `ACCESS_DENIED` / `EMPTY_RESULT`） |
| 5 | 上游 API/网络 | 超时、5xx、`data_resource_url`/`latest_version`/`json_url` 缺失（`retryable: true` 的都在此类） |
| 6 | 转换失败 | schema→HTML 异常（Tailwind 回退不算，记 degraded） |
| 7 | 本地 IO | 落盘/下载写文件失败 |
| 8 | `--strict` 下由 warning 升级 | 明确区分"真失败"与"严格模式拦截" |
| 9 | 批处理部分失败 | `--keep-going` 下部分条目失败（全失败时取主导错误类别码）；明细在 stdout NDJSON 的 `ok:false` 行，汇总在 stderr |

错误码在 `core/errors.ts` 统一注册：`code → { exitClass, severity, retryable, hintTemplate }`。蓝湖"HTTP 200 + null payload"的歧义（URL 不完整 / 无权限 / token 失效三种可能）保留上游的合并提示，但拆出 `EMPTY_RESULT` 码并在 hint 中给出排查顺序（先 `lanhu auth test`，再核对 URL 完整性）。

### 6.3 重试策略

仅对 `retryable: true`（网络超时、5xx、OSS 下载）做有限重试（默认 2 次、指数退避，`--retries` 可调）；对 URL/权限/token 类错误**绝不重试**（沿用上游 troubleshooting 的纪律：不要用盲目重试绕过凭据问题）。

---

## 7. 配置与凭据

优先级（与上游一致并延伸）：**CLI flag > 进程环境变量 > env 文件（`--env-file` > `ENV_FILE` > cwd/.env.local）> `lanhu.config.{ts,json}`（c12，项目级）> 用户级 config.json > 默认值**。

用户级配置路径跨平台解析，不硬编码 `~/.config`：`$XDG_CONFIG_HOME/lanhu/` > Linux/macOS `~/.config/lanhu/` > Windows `%APPDATA%\lanhu\`。

- `lanhu auth set`：交互（TTY）或 `--token-stdin`（自动化，避免进 argv）写入用户级配置（文件权限 0600）；项目内仍推荐 `.env.local` 以隔离多项目 token。
- `lanhu auth status`：显示 token 来源（flag/env/文件路径）+ 掩码指纹 + 是否配置 DDS_TOKEN。
- `lanhu auth test`：调一次轻量主站 API 验证活性，输出 `{ok, expiresHint}`——CI 与 skills 排障的第一步。
- `lanhu.config.ts` 承载项目级默认：`tailwind/twVersion/unitScale/outDir/assetsDir/lang`，让重复 flag 收敛进仓库。

---

## 8. skills 调度设计（AI 集成）

`skills/lanhu-cli/SKILL.md` 面向 Agent 的调度逻辑，核心是**场景 → 命令序列**映射，而非重复 flag 文档。

**写作规范**：全部用中文编写，读者是程序员（以及替程序员干活的 Agent），内容组织贴合工程师思维——

- 以"输入 → 命令 → 退出码/输出 → 下一步"的执行心智组织，不写营销式功能介绍；
- 一切结论给可复制运行的命令与真实输出示例（envelope JSON、退出码），不用抽象描述代替代码块；
- 排障按退出码/错误码索引（工程师从报错反查），不按功能章节；
- 约定优先于解释：先给推荐命令序列，再在需要处一句话说明为什么；
- 术语保持代码同名（flag、错误码、字段名不翻译），叙述用中文。

**触发设计（frontmatter description）**——skill 能否被 Agent 正确调起取决于此，与内容质量同等重要：

- 触发词：蓝湖 / lanhu / `lanhuapp.com` URL / 设计稿转代码 / 切图下载 / design tokens / DDS。
- 适用场景：给出蓝湖设计稿链接要求实现页面或组件；下载切图到项目；提取或核对设计 token。
- 负例边界（写进 description 防误触发）：Figma、Sketch、MasterGo 等非蓝湖平台；没有设计稿 URL 的纯视觉讨论。
- description 示例：`蓝湖(Lanhu)设计稿转前端实现上下文：当用户给出 lanhuapp.com 设计稿 URL，或要求从蓝湖获取 HTML/CSS、切图、design tokens 时使用。不适用于 Figma 等其他设计平台。`

**场景 → 命令序列**：

| 场景 | Agent 调度序列 |
| --- | --- |
| 从设计稿实现页面（默认） | `lanhu auth test` → 读项目判断 Tailwind → `lanhu context <url> --json`（按项目加 `--tailwind --tw-version N`）→ 读 context.md → `lanhu assets <url> --download -o <项目资产目录>` → 写业务代码 |
| 只分析布局结构 | `lanhu html <url> --skip-slices`（stdout 直接进上下文，不落盘） |
| 建立/核对设计系统 | `lanhu tokens <url> --format css` 与项目现有变量 diff |
| 批量导出整个项目 | URL 列表 → `lanhu context --stdin --keep-going --json`，逐行解析 NDJSON |
| 排障 | 按退出码分派：2→检查 URL 参数完整性；3/4→`lanhu auth test` + 重取 Cookie；5→`--retries`/`--timeout`；9→逐行解析 NDJSON 定位 `ok:false` 条目；其余→`lanhu doctor` |

SKILL.md 行为约束（沿用上游技能的纪律并适配新 CLI）：

1. 一律带 `--json`，解析 envelope 而不是抓取自由文本；先看 `ok` 与 `error.code`，再看 `warnings[]` 决定是否需要补救（如 tokens 缺失时不虚构 token）。
2. 不回显 token；凭据问题只引导用户运行 `lanhu auth set`。
3. 尊重严重性分级：degraded 不视为失败，但要在答复中如实告知用户哪些附属产物缺失。
4. 优先原子命令按需取数据，避免每次都跑完整 `context`（省时间与上下文窗口）。

references/ 保留：`cli-reference.md`（参数表）、`pipeline.md`（管道配方）、`troubleshooting.md`（按退出码组织）、`mcp-boundary.md`（何时改用 MCP 模式）。

---

## 9. MCP 兼容层

`packages/mcp` 保持与 lanhu-context-mcp 的对外契约，迁移零成本：

- 工具名 `get_design_context`、入参 `{url}`、inline/files 两种 mode、resource_link 返回结构不变；
- `lanhu mcp --stdio|--http --host --port --mode` 对应上游 server flags；
- 差异点：内部走 core 的分级严重性——degraded 阶段失败不再整体报错，而是在返回文本中附 warnings 段（行为变化在文档中标注，`--compat-strict` 可回退上游"全停"语义）。

---

## 10. 开发流程规范

| 环节 | 规范 |
| --- | --- |
| 测试分层 | 单测（vitest，core 纯函数与错误码映射）；集成测试（`RUN_INTEGRATION=1` + `LANHU_TEST_URL`，触真实 API，沿用上游模式）；E2E smoke（对构建产物跑 `--version`、`parse` 等离线命令） |
| 静态检查 | typecheck（`tsc --noEmit`）+ lint/format（biome 或 eslint+prettier，全仓统一）；提交前本地跑通 |
| CI 矩阵 | Node 20/22 ×（typecheck + lint + 单测 + 构建 + bin smoke）；集成测试仅手动/定时触发，凭据走 CI secret |
| 发布流程 | changesets 管版本与 CHANGELOG（见 §3"版本与发布"）；semver 语义：修复→patch，新命令/新 flag→minor，破坏输出契约/退出码/MCP 签名→major；发布前 `pnpm pack` 后全局安装做 bin smoke test；`npm publish --provenance` |
| 兼容纪律 | flag/命令重命名保留旧别名 ≥1 个 minor 周期，旧名使用时 stderr 提示 deprecation；envelope 字段与退出码语义只增不改 |

## 11. 实施里程碑

每个里程碑附验收标准（DoD），达成即可演示：

1. **M1 core 移植**：url/api/transform/pipeline 从上游平移（axios→ofetch），补 `errors.ts` 分级模型；单测同步迁移。
   - DoD：迁移单测全绿；错误码表专测覆盖 code → 退出码类别/severity/retryable 全映射；core 零终端/协议依赖（依赖检查通过）。
2. **M2 CLI 骨架**：citty 命令树 + io/exit + `parse/schema/html/context` 四命令跑通管道；集成测试复用 `LANHU_TEST_URL` 模式。
   - DoD：§4.4 前两个管道示例对真实 URL 原样可执行；退出码 0/2/3/4/5 各有集成用例；§5 输出契约测试通过（报告类无 TTY 自动 `--json`、产物流原样直出、失败 envelope 走 stdout）。
3. **M3 全命令**：`meta/tokens/assets/preview/auth/doctor`、批量 stdin、幂等下载。
   - DoD：全部命令 `--help` 含可运行示例；`--keep-going` 部分失败退出码 9 + NDJSON 明细有测试；`assets --download` 二次执行全 `skipped`（幂等验证）；`auth` 三件套对真实 API 联通。
4. **M4 MCP 兼容层 + skills**：`packages/mcp` 与 `skills/lanhu-cli`；对照上游集成测试验证工具签名兼容。
   - DoD：`get_design_context` 入参/返回结构与上游对照测试通过（含 `--compat-strict` 回退语义）；SKILL.md 触发 description 就位，§8 五场景在 playground 各演练通过一次。
