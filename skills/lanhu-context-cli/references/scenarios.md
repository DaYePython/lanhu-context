# scenarios：执行场景 2–5（步骤 + 实测输出）

由 SKILL.md 的场景索引路由到本文件；场景 1（从设计稿实现页面，默认路径）保留在 SKILL.md 本体，编号全局一致。命令统一写 `lanhu`，未安装 CLI 时替换为 `npx -y -p @lanhu-context/cli lanhu`。SKILL.md 的执行边界（一律 `--json`、token 绝不回显、附属缺失降级等）在所有场景中持续生效。

## 场景 2：只分析布局结构（不落盘）

输入：URL，只想看层级/布局，不需要图片资产。

```bash
lanhu html "$URL" --skip-slices
```

- stdout 直接输出 HTML+CSS 本体（无 TTY 也原样输出，可直接进上下文或 `> page.html`）；本次实测 67 KB、exit 0。
- `--skip-slices` 不处理切图：跳过切图定位与下载清单，图片保持蓝湖 OSS 远程 URL——纯布局分析不需要下载任何东西。
- `--unit-scale` 按倍率缩放输出里的 px 数值：2x 稿要 1x 数值 → `--unit-scale 0.5`。倍率先自行从项目判断（px2rem/viewport 配置、设计稿宽度 vs 容器宽度），判断不了就问用户，无法询问时默认 1（不缩放）并在结果中注明——完整判定顺序见 [cli-reference.md](cli-reference.md) 的 `--unit-scale` 小节。

## 场景 3：建立/核对设计系统

输入：URL + 项目现有 CSS 变量文件。

```bash
lanhu tokens "$URL" --format css > /tmp/lanhu-tokens.css
diff /tmp/lanhu-tokens.css src/styles/design-tokens.css
```

- 提取到 tokens：stdout 输出 `:root { --var: … }`，与项目变量 diff 后给出差异结论。
- **提取不到 tokens（常见，不算失败）**：stdout 输出 `:root {}`、stderr `WARN TOKENS_UNAVAILABLE`、exit 0——如实告知"该设计稿无可提取的高风险 token"，不要编造变量；`--strict` 下会变成 exit 8。
- 要结构化条目走 `lanhu tokens "$URL" --json`，看 `data.count` / `data.tokens[]`。

## 场景 4：登录 / 配置凭据（首次使用或 Cookie 失效）

输入：任意命令报 exit 3（`TOKEN_MISSING`）或 exit 4（`AUTH_EXPIRED`），或用户明说要登录/配置蓝湖凭据。登录不要求先装好 CLI——npx 形态照常可用。

装了配套浏览器扩展（安装见 `ecosystem/browser-extension/README.md`，GitHub Releases 有预构建 zip）或油猴脚本（安装见 `ecosystem/lanhu-monkey/README.md`，Releases 有预构建 .user.js）→ 优先 `auth listen` 一键登录：

```bash
lanhu auth listen --json
# 未安装 CLI 时（npx 免安装登录）：
npx -y -p @lanhu-context/cli lanhu auth listen --json
```

启动后引导用户在**已登录**的蓝湖设计稿页面右键 → 点「发送 cookies 到本机」（默认 120s 内有效，用户操作慢就加 `--timeout 300`）。实测输出（监听提示与 ℹ 摘要走 stderr，stdout 只有末行 envelope；FAKE 演示 token，路径缩略）：

```text
$ lanhu auth listen --json
listening  http://127.0.0.1:7623/token（仅接受浏览器扩展 / 油猴脚本来源）
           在蓝湖设计稿页面右键点击「发送 cookies 到本机」，120s 内有效
ℹ 运行 `lanhu auth test <url>` 验证 token 活性
{"ok":true,"command":"auth listen","data":{"path":"…/.config/lanhu/config.json","mode":"0600","updated":["LANHU_TOKEN"],"fingerprint":"sid=…AKE2 (length 19)"},"warnings":[],"meta":{"version":"0.5.0","durationMs":1374}}
```

- 收到一次即写入用户级配置（0600）并退出；`data.updated` 列出写入项，`data.fingerprint` 是掩码指纹，不含明文（SKILL.md 边界 2 仍生效）。
- 超时未点 → exit 3（`TOKEN_MISSING`）且不写任何凭据：重跑再点即可；端口被占 → exit 7，换 `--port` 需同步扩展/油猴共享常量（两者均见 [troubleshooting.md](troubleshooting.md)）。

没装扩展 → `auth set` 手动粘贴：交互运行 `lanhu auth set`（stderr 打印获取 Cookie 的分步引导，输入隐藏不回显）；CI/脚本走 `printf "%s\n" "$LANHU_TOKEN" | lanhu auth set --token-stdin`；或直接写 `<cwd>/.env.local`（`LANHU_TOKEN=...`）。

无论哪条路径，收尾都验证活性：

```bash
lanhu auth test "$URL" --json
# → exit 0：token 有效，回到原任务；exit 4：Cookie 仍无效/无权限，重取一次；仍失败按场景 5 分派
```

## 场景 5：排障（按退出码分派）

先看退出码，再看 `error.code`，按表执行动作；完整索引见 [troubleshooting.md](troubleshooting.md)。

| 退出码 | 典型 error.code | 动作 |
| --- | --- | --- |
| 2 | `URL_MISSING_TID` / `URL_MISSING_PID` / `URL_MISSING_IMAGE_ID` / `USAGE_ERROR` | 检查 URL 是否含 tid/pid/image_id 三参数（从浏览器地址栏复制完整 URL）；`USAGE_ERROR` 按 message 修正 flag 组合 |
| 3 | `TOKEN_MISSING` / `CONFIG_INVALID` | 按场景 4 登录（扩展在手优先 `lanhu auth listen`，否则 `lanhu auth set` 或写 `<cwd>/.env.local`；listen 等待超时同为 exit 3——重跑并在超时前于蓝湖页面右键点「发送 cookies 到本机」）；核对 `--cwd`/`--env-file` 路径 |
| 4 | `AUTH_EXPIRED` / `ACCESS_DENIED` / `EMPTY_RESULT` / `TRANSCODE_NOT_ENABLED` | `lanhu auth test "$URL" --json` 复核；过期则按场景 4 重新登录换新 Cookie；`EMPTY_RESULT` 按 token → URL → 转码开关顺序排查；`TRANSCODE_NOT_ENABLED` 是设计稿上传时没开「设计图转代码」，引导在蓝湖删除后重新上传并勾选该选项，转码完成后重试 |
| 5 | `UPSTREAM_TIMEOUT` / `UPSTREAM_ERROR` / `SCHEMA_FIELD_MISSING` | retryable：加 `--retries 3` / 调大 `--timeout`；`SCHEMA_FIELD_MISSING` 是设计稿未转码完成，引导在蓝湖重新处理 |
| 8 | `--strict` 升级的 warning | 看 stderr 列出的 warning 码；确属可接受的附属内容缺失则去掉 `--strict` 重跑 |
| 1/6/7 | `UNKNOWN` / `TRANSFORM_FAILED` / `IO_WRITE_FAILED` | `lanhu doctor --json` 环境自检；7 检查目录可写与磁盘空间（`auth listen` 报 7 是端口被占用 → 换 `--port` 并同步扩展常量）；6 落盘 schema 复查（`lanhu schema "$URL" > page.schema.json`） |

对 URL/权限/token 类错误（exit 2/3/4）**绝不重试**——重试绕不过凭据问题。
