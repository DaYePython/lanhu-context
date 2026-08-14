---
name: lanhu-context-mcp
description: 蓝湖(Lanhu) MCP server 配置与排障：当用户要在 Claude Code / Cursor / Codex 等 MCP 客户端里以工具形式使用蓝湖设计稿（get_design_context），要启动 `lanhu-context-mcp`（stdio/http，npm 包 @lanhu-context/mcp），或要从上游 lanhu-context-mcp npm 包迁移时使用。不适用于直接在终端跑蓝湖导出命令（那是 lanhu-context-cli skill 的场景），也不适用于 Figma、Sketch、MasterGo 等非蓝湖平台。
---

# lanhu-context-mcp（MCP 兼容层）

`lanhu-context-mcp`（npm 包 `@lanhu-context/mcp` 自带的 bin）启动一个 MCP server，注册唯一工具 `get_design_context`，对外契约与上游 `lanhu-context-mcp` npm 包完全一致（工具名、入参 `{url}`、inline/files 两种 mode、resource_link、isError + STOP 错误文本）。内部走 `@lanhu-context/core` 的分级严重性管道，默认行为差异见下文 `--compat-strict`。

CLI 直调（`lanhu context` / `lanhu html` 等原子命令、退出码、envelope）不在本 skill 范围，见 `lanhu-context-cli` skill；CLI 包 `@lanhu-context/cli` 不含 MCP 功能。

## 何时用 `lanhu-context-mcp`，何时用 CLI

| 场景 | 用什么 |
| --- | --- |
| Agent 能直接执行 shell 命令 | CLI 直调（`lanhu context <url> --json` 等）。原子命令 + 退出码 + envelope 比协议往返更省上下文，见 lanhu-context-cli skill |
| MCP 客户端（Claude Code / Cursor / Codex / TRAE 等）内以工具形式消费 | `lanhu-context-mcp` |
| 已有基于上游 `lanhu-context-mcp` 包的客户端配置，想换到本仓实现 | `lanhu-context-mcp`，按下方迁移对照表改配置 |
| 管道组合、CI 集成 | CLI：退出码 + 统一 JSON 输出（envelope）好编排；MCP 只面向客户端内的工具调用 |

## 启动

凭据解析顺序（与 CLI 不同，本 bin 只认三处）：env `LANHU_TOKEN` / `DDS_TOKEN` > `--env-file <path>` > `<cwd>/.env.local`。token 是已登录 lanhuapp.com 会话的整段浏览器 Cookie，绝不放进 argv。

stdio（默认，MCP 客户端拉起子进程）：

```bash
LANHU_TOKEN="<cookie>" lanhu-context-mcp --stdio
# 未全局安装时（包名即 bin 名，npx 可直接定位入口）：
npx -y @lanhu-context/mcp --stdio
```

stdio 模式 stdout 只承载 JSON-RPC 帧，所有日志走 stderr——不要在包装脚本里向 stdout 打印任何东西。

streamable HTTP（常驻进程，POST /mcp）：

```bash
lanhu-context-mcp --http --host 127.0.0.1 --port 5200
```

启动成功的 stderr（真实输出）：

```text
[http] MCP server running on http://127.0.0.1:5200/mcp
get_design_context 已注册；POST http://127.0.0.1:5200/mcp
```

只接受 `POST /mcp`；`GET`/`DELETE` 返回 `405`（`Allow: POST`），其他路径 `404`。

完整 flags 看 `lanhu-context-mcp --help`。要点：

| flag | 说明 |
| --- | --- |
| `--stdio` / `--http` | transport，二选一（同时传是 USAGE_ERROR，exit 2），默认 stdio |
| `--host` / `--port` | 仅 `--http`；默认 `127.0.0.1:5200` |
| `--mode <inline\|files>` | 工具默认输出模式，默认 `inline` |
| `--out-dir <path>` | files 模式落盘目录，默认 `<cwd>/.lanhu.local` |
| `--compat-strict` | 恢复上游"任一阶段失败全停"语义 |
| `--tailwind --tw-version <3\|4>` / `--skip-slices` / `--unit-scale <n>` / `--assets-dir <path>` | 与 CLI 的 `html`/`context` 同义，作用于工具产出 |
| `--lang <zh-CN\|en-US>` | 工具描述/指引/错误文本语言，默认 en-US |
| `--env-file <path>` / `--timeout <ms>` | env 文件路径 / 蓝湖 API 超时 |

## 客户端配置示例

MCP 客户端拉起子进程时 cwd 通常不是你的项目根：`<cwd>/.env.local` 不会被自动找到。要么在客户端配置的 `env` 里传 `LANHU_TOKEN`，要么用 `--env-file <项目内 .env.local 的绝对路径>`。推荐后者，token 不进配置文件。

Claude Code（stdio）：

```bash
claude mcp add lanhu -- lanhu-context-mcp --stdio --env-file /abs/path/to/project/.env.local
# 未全局安装时：
claude mcp add lanhu -- npx -y @lanhu-context/mcp --stdio --env-file /abs/path/to/project/.env.local
```

Cursor / 通用 `.mcp.json`（stdio）：

```json
{
  "mcpServers": {
    "lanhu": {
      "command": "npx",
      "args": [
        "-y", "@lanhu-context/mcp",
        "--stdio",
        "--env-file", "/abs/path/to/project/.env.local",
        "--lang", "zh-CN"
      ]
    }
  }
}
```

HTTP（先手动 `lanhu-context-mcp --http --port 5200` 常驻）：

```bash
claude mcp add --transport http lanhu http://127.0.0.1:5200/mcp
```

```json
{
  "mcpServers": {
    "lanhu": { "url": "http://127.0.0.1:5200/mcp" }
  }
}
```

## `--mode` 与 `--compat-strict` 语义

工具 `get_design_context` 入参只有 `{url}`（蓝湖设计稿详情链接，含 `tid`/`pid`/`image_id`）。返回结构由启动时的 `--mode` 决定：

- `inline`（默认）：`content` 数组依次为 `text(HTML+CSS/Tailwind)`、`text(切图映射, curl 命令)`（有切图时）、`text(Design Tokens)`（可提取时）、`text(实现指引)`、`image(preview.png base64)`（有预览图时）。
- `files`：落盘到 `--out-dir` 下 `<设计稿名>-<imageId 前 8 位>/`，`content` 只含 `resource_link`（`file://` URI 的 `context.md`，有预览图时再加 `preview.png`）。产物大时选 files，避免 base64/HTML 撑爆客户端上下文。

附属内容缺失时的处理（与上游的行为差异，默认开启）：

- tokens 提取失败、预览图下载失败、Tailwind 转换回退 —— 核心 HTML 产物照常返回，调用不报错；缺失项记录在返回文本末尾的 `warnings:` 段（inline 附在指引段末尾，files 附在 `context.md` 末尾）：

  ```text
  warnings:
  - TOKENS_UNAVAILABLE (degraded): Failed to extract design tokens: ...
  ```

  Agent 消费时：看到 `warnings:` 段照常使用 HTML，但如实告知用户缺了哪个附属产物，不要虚构 tokens/预览。
- `--compat-strict`：恢复上游语义——任一附属阶段失败即整体失败，返回 `isError: true` + 单条 text（阶段错误信息 + STOP 指令文本），不产出任何内容。适合依赖上游"要么全有要么全无"行为的既有流程。

URL 解析失败、token 失效、schema 拉取失败等致命错误在两种模式下都返回 `isError: true` + STOP 文本（与上游一致），MCP 协议层面仍是成功响应。

## 从上游 lanhu-context-mcp 迁移

启动命令：`npx -y lanhu-context-mcp <flags>` → `npx -y @lanhu-context/mcp <flags>`（bin 名不变，仍是 `lanhu-context-mcp`）。

| 上游 flag | 本实现 | 说明 |
| --- | --- | --- |
| `--lanhu-token` / `--dds-token` | （移除） | token 只走 env `LANHU_TOKEN` / `DDS_TOKEN` 或 env 文件，不进 argv |
| `--http-timeout <ms>` | `--timeout <ms>` | 更名 |
| `--stdio` / `--http` / `--host` / `--port` | 同名 | 默认值相同（stdio；127.0.0.1:5200） |
| `--tailwindcss` | `--tailwind` | 更名 |
| `--tw-version` / `--skip-slices` / `--unit-scale` | 同名 | 不变 |
| `--prompt-lang` | `--lang` | 更名 |
| `--env-file` / `--env-path` | `--env-file` | 统一为 `--env-file` |
| `--cwd` | （移除） | 用 `--env-file` 传绝对路径替代"到项目根找 .env.local" |
| `--mode <inline\|files>` | 同名 | 不变 |
| `--out-dir` | 同名 | **默认目录变更**：`.lanhu-context-mcp.local` → `.lanhu.local`；要保持旧路径显式传 `--out-dir .lanhu-context-mcp.local` |
| （无） | `--compat-strict` | 新增：恢复上游全停语义 |

环境变量：`LANHU_TOKEN` / `DDS_TOKEN` 继续生效。上游的 `ENV_FILE` / `PROMPT_LANG` / `STDIO` / `MODE` / `OUT_DIR` / `PORT` / `HOST` / `TAILWINDCSS` / `TW_VERSION` / `SKIP_SLICES` / `UNIT_SCALE` / `HTTP_TIMEOUT` 环境变量在本实现中**不再读取**，迁移时改为对应 flag。

工具契约不变项：工具名 `get_design_context`；入参 schema `{url: string}`（描述文本随 `--lang` 与上游同文案）；inline content 顺序；files 模式 resource_link（`context.md` + `preview.png`）；错误 isError + STOP 文本。客户端侧无需改任何工具调用代码。

行为变更项只有一个：附属内容缺失默认不整体报错、记入 `warnings:` 段（上文），`--compat-strict` 回退上游行为。

## 排障（按症状 → 退出码/错误码索引）

server 是长驻进程：启动失败看进程退出码，工具调用失败看返回内容（`isError` + 文本），两层分开排查。

### 进程启动即退

| 退出码 | stderr 特征 | 原因 → 动作 |
| --- | --- | --- |
| 2 | `USAGE_ERROR: --mode 期望 "inline" 或 "files"` | flag 值非法；同类还有 `--stdio 与 --http 互斥`、`--port 期望 1~65535 的整数`、`未知参数` → 修 flag 重启 |
| 4 | `TOKEN_MISSING: 未找到 LANHU_TOKEN` | 客户端拉起的子进程 cwd 不是项目根，`.env.local` 没被读到 → 配置里加 `--env-file /abs/path/to/project/.env.local`，或在客户端配置 `env` 里传 `LANHU_TOKEN` |
| 1 | `EADDRINUSE`（`--http`） | 端口被占 → 换 `--port` |

真实输出示例（exit 4）：

```text
TOKEN_MISSING: 未找到 LANHU_TOKEN（已登录 lanhuapp.com 会话的整段浏览器 Cookie）。
hint: 通过环境变量 LANHU_TOKEN、--env-file <path> 或 <cwd>/.env.local 提供。
```

### 客户端连不上 / 协议报错

- stdio 下客户端报 JSON parse error：stdout 被污染。`lanhu-context-mcp` 自身日志全走 stderr；检查是否用 `npm run` / shell 包装脚本启动（它们会往 stdout 打 banner）→ 直接用 bin（`lanhu-context-mcp` 或 `npx -y @lanhu-context/mcp`）。
- HTTP 收到 `405 Method Not Allowed`：只支持 `POST /mcp`，客户端 transport 选 streamable HTTP（不是 SSE/GET）。
- HTTP 收到 `404`：路径必须是 `/mcp`。

### 工具调用返回 isError + STOP 文本

这不是协议错误，是业务失败；按文本中的错误信息分派：

| 文本特征 | 原因 → 动作 |
| --- | --- |
| `must contain a tid` / `pid` / `image_id` | URL 不完整 → 让用户从浏览器地址栏复制完整设计稿详情 URL |
| `returned empty result` / `EMPTY_RESULT` 语义（HTTP 200 空 payload） | token 过期 / 无权限 / URL 不完整其一 → 按 token → URL → 转码开关顺序排查：先在终端跑 `lanhu auth test`（CLI，见 lanhu-context-cli skill），再核对 URL；token 过期则重新登录蓝湖取整段 Cookie 后重启 server |
| `TRANSCODE_NOT_ENABLED` / `版本数据不存在` | 设计稿上传时未开启「设计图转代码」，蓝湖没有结构数据 → 在蓝湖删除后重新上传并勾选「设计图转代码」，转码完成后重试；换 token/重试无用 |
| `Failed to extract design tokens` / `Failed to download design preview`（仅 `--compat-strict` 下出现为错误） | 上游全停语义生效 → 去掉 `--compat-strict` 接受"缺附属内容但有核心结果"的产出，或稍后重试 |
| `Failed to write` | `--out-dir` 不可写 → 检查目录权限/磁盘 |

STOP 指令文本本身（"STOP: Do NOT attempt to continue..."）是给 Agent 的行为约束：不要重试绕过，把错误报给用户。

### 返回末尾出现 `warnings:` 段

不是失败。核心 HTML 可直接使用；按行内的错误码判断缺了什么（`TOKENS_UNAVAILABLE` / `PREVIEW_UNAVAILABLE` / `TAILWIND_FALLBACK`），在答复中如实说明。需要硬失败语义时改用 `--compat-strict` 重启 server。

### 进一步定位

复杂问题可绕开协议在终端直接复现同一条管道（CLI 与本 server 共用 `@lanhu-context/core` 的错误码体系）：

```bash
lanhu auth test
lanhu context "<同一个 URL>" --json
```

按退出码排障的完整索引见 lanhu-context-cli skill 的 troubleshooting 参考。
