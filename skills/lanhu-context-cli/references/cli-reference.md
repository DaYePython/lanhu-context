# cli-reference：命令、flags、退出码、配置

以 `lanhu v0.2.0` 的 `--help` 实测输出为准（`lanhu-context` 为等价全名 bin；未安装时用 `npx -y -p @lanhu-context/cli lanhu`）。

## 命令总览

「类别」两种：**报告** = stdout 输出结构化结果（无 TTY 时自动转 envelope JSON）；**直出** = stdout 就是内容本体（HTML/schema/PNG 等，接管道/重定向稳定不变形）。

| 命令 | 类别 | 职责 | stdout 行为 |
| --- | --- | --- | --- |
| `lanhu parse <url\|->` | 报告 | URL/query 串 → `{teamId, projectId, imageId}` | envelope（无 TTY 自动 `--json`） |
| `lanhu meta <url\|->` | 报告 | 元数据 `{name, projectName, imageId, previewUrl, versions:{count, latestHasSketchJson}}` | 同上 |
| `lanhu schema <url>` | 直出 | 下载原始 DDS schema JSON | schema JSON 本体（存文件复查或喂给 `html -`） |
| `lanhu html <url\|->` | 直出 | 设计稿 → HTML+CSS（或 Tailwind）；`-` 时从 stdin 读 schema 离线转换，不请求蓝湖 | HTML 本体 |
| `lanhu tokens <url>` | 直出 | 提取视觉 token（渐变/边框/圆角/阴影/透明度） | `--format json`（默认）条目数组 / `--format css` `:root {}` |
| `lanhu assets <url>` | 报告 | 切图映射（本地路径 → 远程 URL）；`--download` 才实际下载 | 映射 JSON / 下载报告 envelope |
| `lanhu preview <url>` | 直出 | 预览图 PNG | `-o <file>` 写文件 + 报告（重复执行安全）；`-o -` PNG 二进制直出（无 envelope，状态看退出码 + stderr） |
| `lanhu context <url>` | 复合 | 一次产出 context.md（HTML + 切图映射 + tokens + 实现指引）+ preview.png | 文件清单 envelope；`--inline` 时 context 正文直出（摘要走 stderr） |
| `lanhu auth set\|status\|test` | 报告 | 凭据写入（0600）/ 状态（来源 + 掩码指纹）/ 验证 token 是否有效 | 状态 envelope，永不含 token 明文 |
| `lanhu doctor` | 报告 | 自检：node 版本 / lanhuapp.com 与 dds.lanhuapp.com 可达性 / token / cwd 可写 / 输出目录可写或可创建（`--out-dir` 指定要检查的目录，缺省检查默认的 `<cwd>/.lanhu.local`） | 检查报告；个别失败仍全部跑完，退出码取失败最多的类别（3/5/7） |

通道纪律：stdout 只承载数据/产物，日志与进度走 stderr。直出类命令无论有无 TTY 都原样输出内容本体；显式 `--json` 才改为 envelope（内容放进 `data`）。两条边界：`context --inline` 与 `--json` 互斥；`preview --json` 必须配 `-o <file>`——违反均为 `USAGE_ERROR`（exit 2）。

## 全局 flags（所有命令通用）

| flag | 默认值 | 对应 env | 说明 |
| --- | --- | --- | --- |
| `--token <string>` | — | `LANHU_TOKEN` | 登录 lanhuapp.com 的整段浏览器 Cookie；优先用 env/.env.local，避免进 shell 历史 |
| `--dds-token <string>` | 复用 `--token` | `DDS_TOKEN` | dds.lanhuapp.com 凭据 |
| `--timeout <ms>` | `30000` | — | HTTP 超时 |
| `--retries <n>` | `2` | — | 仅对可重试错误（网络超时/5xx/下载）重试，指数退避 |
| `--env-file <path>`（别名 `--env-path`） | `<cwd>/.env.local` | — | env 文件路径 |
| `--cwd <path>` | 进程 cwd | — | 指定工作目录：env 文件查找与相对路径都以它为基准 |
| `--json` | `false` | — | 以统一 JSON 结构输出结果（含 ok/data/error/warnings 字段）；输出报告的命令在 stdout 接管道或重定向时自动开启 |
| `-q, --quiet` | `false` | — | stderr 只保留 error |
| `--verbose` | `false` | — | stderr 输出 debug 日志（含各阶段耗时） |
| `--no-color`（即 `--color=false`，默认 `--color` 为 true） | — | `NO_COLOR` | 禁用颜色 |
| `--strict` | `false` | — | 把所有 warning 当作失败处理（退出码 8），适合 CI 严格把关 |
| `--lang <zh-CN\|en-US>`（别名 `--prompt-lang`） | `en-US` | — | context.md 等指引文本语言 |
| `--version` | — | — | 版本；与 `--json` 组合输出 `{"name":"@lanhu-context/cli","version":"0.2.0","node":"v22.22.0"}` |

别名一律用双横线（`--env-path` / `--prompt-lang` / `--tailwindcss`）；`--help` 里把别名显示成单横线（如 `-env-path`）只是 citty 的展示格式，单横线写法不会被解析。

## 命令级 flags

| 命令 | flag | 默认值 | 说明 |
| --- | --- | --- | --- |
| `html` / `context` | `--tailwind`（旧名 `--tailwindcss` 已废弃仍可用） | `false` | CSS → Tailwind 工具类 |
| `html` / `context` | `--tw-version <3\|4>` | `3` | Tailwind 引擎版本 |
| `html` / `context` | `--unit-scale <n>` | — | 输出尺寸的缩放倍数（设计稿是 2 倍图时用 `0.5` 得到 1 倍尺寸） |
| `html` / `context` | `--skip-slices` | `false` | 不处理切图：跳过切图定位与下载清单，图片保持蓝湖远程 URL（只看布局时更快） |
| `html` / `context` / `assets` | `--assets-dir <path>` | `./src/assets/<设计稿名>` | 生成代码里图片引用的本地路径前缀 |
| `context` | `--inline` | `false` | 不写文件，把 context 正文直接输出到 stdout（与 `--json` 互斥） |
| `context` | `--out-dir <path>` | `<cwd>/.lanhu.local` | 落盘目录 |
| `context` / `assets` / `preview` | `--force` | `false` | 不比对已有文件内容，强制重写全部输出文件（默认内容相同的文件自动跳过） |
| `tokens` | `--format <json\|css>` | `json` | 输出格式 |
| `assets` | `--download` | `false` | 实际下载切图到本地（默认只列出映射、不下载） |
| `assets` | `--concurrency <n>` | `4` | 并发下载数 |
| `assets` | `--dry-run` | `false` | 配合 `--download`：只列出将下载哪些文件，不实际写盘 |
| `assets` | `-o, --output <dir>` | — | 下载保存目录，同时作为映射本地路径前缀（优先于 `--assets-dir`） |
| `preview` | `-o, --output <file\|->` | — | PNG 输出位置：文件路径（重复执行安全，内容相同自动跳过）或 `-` 直接输出二进制到 stdout |
| `auth set` | `--token-stdin` / `--dds-token-stdin` | `false` | 非 TTY 必须用：从 stdin 读 token（两者同传时第 1 行 LANHU_TOKEN、第 2 行 DDS_TOKEN） |
| `doctor` | `--out-dir <path>` | `<cwd>/.lanhu.local` | 要检查的输出目录（与 `context --out-dir` 同义），检查其可写或可创建 |

`auth test [url]`：位置参数缺省时回退 `LANHU_TEST_URL` 环境变量；输出 `data: {ok, checkedAt, tokenSource, design:{name, imageId}, hint}`。

### `--unit-scale`：倍率怎么定（完整版）

作用：按倍率缩放输出里的 px 数值。设计稿是 2x、希望按 1x 数值落代码 → 试 `0.5`；设计稿是 1x、希望按 2x 数值输出 → 试 `2`。与在蓝湖平台上开发时的倍率配置是同一个意思。

何时用：

- 接了 px2rem 等转换工具，发现设计稿落地后的尺寸整体偏大或偏小 → 先用 `--unit-scale` 做一次整体校准；
- 明确知道设计稿倍率与目标代码倍率不一致（如 2x 稿落 1x 代码）。

```bash
lanhu html "$URL" --unit-scale 0.5
```

Agent 判定顺序（依次执行，命中即停）：

1. 先自行从目标项目判断：看 postcss/px2rem/rem 换算配置、viewport/设计稿宽度约定（如 750/375）、`lanhu meta` 或预览图宽度与项目容器宽度的对比、项目内现有页面的尺寸习惯；
2. 能判断 → 直接设对应倍率，并在答复中说明依据；
3. 判断不了（信息不足或互相矛盾）→ 询问用户设计稿倍率；用户不在场/无法询问的自动化场景 → 默认 `1`（不缩放），并在结果中注明"未做倍率换算，如尺寸整体偏大/偏小请用 --unit-scale 校准"。

## 输入约定

- 位置参数接受完整 URL、纯 query 串（`tid=..&pid=..&image_id=..`）或 `-`（stdin，`parse`/`meta` 读单条 URL、`html` 读 schema JSON）。
- 无 TTY 时不发起任何交互。

## 退出码

| 退出码 | 类别 | 关联 error.code |
| --- | --- | --- |
| 0 | 成功（允许携带 `warnings[]`：附属内容缺失但核心结果可用，如 `TOKENS_UNAVAILABLE` / `PREVIEW_UNAVAILABLE` / `TAILWIND_FALLBACK` / `ASSET_DOWNLOAD_FAILED`） | — |
| 1 | 未知/内部错误（bug） | `UNKNOWN` |
| 2 | 用法错误 | `URL_INVALID` / `URL_MISSING_TID` / `URL_MISSING_PID` / `URL_MISSING_IMAGE_ID` / `USAGE_ERROR` |
| 3 | 配置/凭据缺失 | `TOKEN_MISSING` / `CONFIG_INVALID` |
| 4 | 认证/权限/空结果 | `AUTH_EXPIRED` / `ACCESS_DENIED` / `EMPTY_RESULT` / `DESIGN_NOT_FOUND` / `TRANSCODE_NOT_ENABLED`（设计稿上传未开启「设计图转代码」） |
| 5 | 上游 API/网络（retryable 都在此类） | `UPSTREAM_TIMEOUT` / `UPSTREAM_ERROR` / `SCHEMA_FIELD_MISSING`（不可重试） |
| 6 | 转换失败 | `TRANSFORM_FAILED`（Tailwind 回退不算，记 warning） |
| 7 | 本地 IO | `IO_WRITE_FAILED` |
| 8 | `--strict` 下 warning 升级 | stderr：`--strict: N warning(s) escalated to failure — <码与消息>` |

## envelope 结构

成功：`{ok:true, command, data:{…}, warnings:[{code, severity, message, hint}], meta:{version, durationMs}}`
失败：`{ok:false, command, error:{code, severity, message, hint, retryable}}`

## 配置优先级

`--token` 等 CLI flag > 进程环境变量 > env 文件（`--env-file` 指定 > `<cwd>/.env.local`）> `lanhu.config.{ts,json}`（项目级）> 用户级 `config.json` > 默认值。

- 用户级配置路径：`$XDG_CONFIG_HOME/lanhu/` > macOS/Linux `~/.config/lanhu/config.json` > Windows `%APPDATA%\lanhu\`；`lanhu auth set` 写入并置权限 0600。
- `lanhu auth status --json` 可直接看当前生效来源（实测）：

```json
{"ok":true,"command":"auth status","data":{"token":{"configured":true,"source":"env-file","fingerprint":"abcd…6789 (length 1024)"},"ddsToken":{"configured":false},"envFilePath":"…/.env.local","userConfigPath":"…/.config/lanhu/config.json","userConfigExists":false},"warnings":[],"meta":{"version":"0.2.0","durationMs":0}}
```
