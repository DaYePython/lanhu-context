# troubleshooting：按退出码排障

用法：拿到非零退出码 → 找到对应小节 → 对照 `error.code` → 执行动作。所有报错输出为 v0.2.0 实测（URL 参数已脱敏）。通用纪律：exit 2/3/4（URL/凭据/权限类）**绝不重试**；只有 `retryable: true`（exit 5 的网络类）值得 `--retries`。

## exit 1 — 未知/内部错误（`UNKNOWN`）

- 症状：非以下任何类别的崩溃。
- 原因：未分类异常，大概率是 bug。
- 动作：`lanhu doctor --json` 排除环境问题；加 `--verbose` 复跑收集 stderr；带命令与设计稿 URL 报告问题。

## exit 2 — 用法错误（`URL_INVALID` / `URL_MISSING_TID` / `URL_MISSING_PID` / `URL_MISSING_IMAGE_ID` / `USAGE_ERROR`）

症状（实测，缺 image_id）：

```text
$ lanhu parse "tid=aaa&pid=bbb" --json
{"ok":false,"command":"parse","error":{"code":"URL_MISSING_IMAGE_ID","severity":"fatal","message":"URL parsing failed: missing required param image_id (docId)","hint":"The URL must contain an image_id (or docId) parameter. Open a specific design in Lanhu before copying the URL.","retryable":false}}
# exit 2
```

- 原因：URL 缺 tid / pid（或 project_id）/ image_id（或 docId）之一，常见于复制了项目列表页而非设计稿详情页，或 shell 把 `&` 截断（URL 必须加引号）。
- 动作：在蓝湖打开**具体设计稿**后从地址栏复制完整 URL，先用 `lanhu parse "$URL" --json` 验证能解析出三元组再跑重命令。
- `USAGE_ERROR` 分支（flag 组合非法，实测）：
  - `context --inline --json` → `context --inline 与 --json 互斥：--inline 的 stdout 即 context 正文本体（需要 envelope 请去掉 --inline）`
  - `preview --json -o -` → `preview --json 必须配 -o <file>：-o - 的 stdout 是 PNG 二进制本体，不能混入 envelope`
  - 动作：按 message 修正组合；`lanhu <command> --help` 看合法用法。

## exit 3 — 配置/凭据缺失（`TOKEN_MISSING` / `CONFIG_INVALID`）

症状（实测，无 token 环境）：

```text
$ lanhu meta "$URL" --json
{"ok":false,"command":"meta","error":{"code":"TOKEN_MISSING","severity":"fatal","message":"LANHU_TOKEN is not configured (checked --token, env LANHU_TOKEN, the env file, lanhu.config.json, and the user config)","hint":"LANHU_TOKEN 是登录 lanhuapp.com 后浏览器请求头中的整段 Cookie。推荐运行 `lanhu auth set` 写入用户级配置（0600），或写入 <cwd>/.env.local（LANHU_TOKEN=...），或用 --token / 环境变量传入。","retryable":false}}
# exit 3
```

- 原因：整条配置链（flag → env → env 文件 → 项目 config → 用户 config）都没有 token；或 `--cwd`/显式 `--env-file` 路径不存在（`CONFIG_INVALID`）。
- 动作：
  1. `lanhu auth status --json` 看链路上到底读到了什么（`data.token.source` / `envFilePath` / `userConfigExists`）。
  2. 引导用户配置：交互 `lanhu auth set`；CI/脚本 `printf "%s\n" "$LANHU_TOKEN" | lanhu auth set --token-stdin`；或写 `<cwd>/.env.local`。
  3. 注意 env 文件默认取 `<cwd>/.env.local`——从别的目录运行时加 `--cwd <项目根>` 或 `--env-file <path>`。

## exit 4 — 认证/权限/空结果（`AUTH_EXPIRED` / `ACCESS_DENIED` / `EMPTY_RESULT` / `DESIGN_NOT_FOUND`）

症状（实测，无效 token）：

```text
$ lanhu meta "$URL" --token "<invalid>" --json
{"ok":false,"command":"meta","error":{"code":"AUTH_EXPIRED","severity":"fatal","message":"Lanhu API /api/project/image rejected the request with HTTP 418 — the token is likely invalid or expired","hint":"The token is a browser Cookie and expires. Log in to lanhuapp.com again, copy the fresh Cookie, and update LANHU_TOKEN.","retryable":false}}
# exit 4
```

- `AUTH_EXPIRED`：token 是浏览器 Cookie，随登录态过期。动作：引导用户重新登录蓝湖 → 复制整段 Cookie → `lanhu auth set` → `lanhu auth test "$URL" --json` 确认 `data.ok: true`。
- `ACCESS_DENIED`：当前账号无该团队/项目/设计稿权限。动作：换账号或找管理员开权限，不要重试。
- `DESIGN_NOT_FOUND`：image_id 在该项目下不存在。动作：核对 URL 指向的设计稿仍存在且账号可见。
- `EMPTY_RESULT`（**HTTP 200 + null payload 三义性**）：蓝湖对"URL 不完整 / 无权限 / token 失效"三种情况都可能返回 200 + 空 result，无法从响应区分。**排查顺序固定**：
  1. 先 `lanhu auth test "$URL" --json`——token 失效会在这里现形（`AUTH_EXPIRED`）；
  2. token 有效再核对 URL：`lanhu parse "$URL" --json` 确认 tid/pid/image_id 三参数完整未截断；
  3. 两者都过则大概率是权限问题，按 `ACCESS_DENIED` 处理。

## exit 5 — 上游 API/网络（`UPSTREAM_TIMEOUT` / `UPSTREAM_ERROR` / `SCHEMA_FIELD_MISSING`）

症状（实测，`--timeout 1 --retries 0` 制造超时）：

```text
$ lanhu meta "$URL" --timeout 1 --retries 0 --json
{"ok":false,"command":"meta","error":{"code":"UPSTREAM_TIMEOUT","severity":"fatal","message":"Lanhu API /api/project/image timed out","hint":"The Lanhu API did not respond in time. Retry, or raise the timeout.","retryable":true}}
# exit 5
```

- `UPSTREAM_TIMEOUT` / `UPSTREAM_ERROR`（`retryable: true`）：默认已带 2 次指数退避重试；仍失败则 `--retries 3 --timeout 60000` 复跑，并 `lanhu doctor --json` 确认 `lanhuapp.com` / `dds.lanhuapp.com` 两项可达性检查。
- `SCHEMA_FIELD_MISSING`（`retryable: false`）：上游 payload 缺 `latest_version` / `data_resource_url` / `json_url`——设计稿未在蓝湖完成转码。动作：在蓝湖重新上传/触发处理该设计稿，**重试无用**。

## exit 6 — 转换失败（`TRANSFORM_FAILED`）

- 症状：schema → HTML 转换抛异常（注意：Tailwind 转换失败**不在此列**，那是 degraded `TAILWIND_FALLBACK`，exit 0 + 保留原 HTML）。
- 动作：`lanhu schema "$URL" > page.schema.json` 落盘原始 schema 复查；`lanhu html - < page.schema.json --verbose` 离线复现；仍失败则带 schema 与 URL 报告。

## exit 7 — 本地 IO（`IO_WRITE_FAILED`）

- 症状：context/assets/preview 落盘失败。
- 动作：检查 `--out-dir`/`-o` 目录是否存在、可写、磁盘是否满；`lanhu doctor --json` 看 `cwd-writable` / `out-dir-creatable` 两项。

## exit 8 — `--strict` 升级的 warning

症状（实测，tokens 空结果 + `--strict`）：

```text
 WARN  TOKENS_UNAVAILABLE: No high-risk design tokens found in this design (empty result)
 ERROR  --strict: 1 warning(s) escalated to failure — TOKENS_UNAVAILABLE: No high-risk design tokens found in this design (empty result)
# exit 8
```

- 原因：不是"真失败"——是 degraded warning（`TOKENS_UNAVAILABLE` / `PREVIEW_UNAVAILABLE` / `TAILWIND_FALLBACK` / `ASSET_DOWNLOAD_FAILED`）被 `--strict` 拦截。
- 动作：看 stderr 列出的 warning 码。该降级可接受 → 去掉 `--strict` 重跑（exit 0 + `warnings[]`）；不可接受 → 按各 warning 的 hint 解决根因（如 tokens 缺失需在蓝湖确认版本转码）。

## exit 9 — 批处理部分失败（`BATCH_PARTIAL`）

症状（实测，2 行输入混 1 条坏 URL）：

```text
$ cat urls_mixed.txt | lanhu context --stdin --keep-going --json --out-dir .lanhu.local > report.ndjson
 ERROR  URL_MISSING_PID: URL parsing failed: missing required param pid (project_id)
ℹ batch: {"total":2,"ok":1,"failed":1}
# exit 9
```

- 原因：`--keep-going` 下部分条目失败；成功条目已正常落盘。
- 动作：
  1. `jq -c 'select(.ok == false) | {input, code: .error.code}' report.ndjson` 定位失败行；
  2. 按每行 `error.code` 回到本文件对应小节处理（本例 exit 2 类：修 URL）；
  3. 只把修好的 `input` 重新喂给 `--stdin`——成功条目幂等，整表重跑也只会 `skipped`。
- 全失败时不是 9，而是取主导错误类别码（如全部 URL 坏 → exit 2）。

## 附：degraded warning 码速查（exit 0，不是失败）

| code | 含义 | 补救 |
| --- | --- | --- |
| `TOKENS_UNAVAILABLE` | Sketch JSON 缺失/不可读或无高风险 token，tokens 为空 | 需要 tokens 时在蓝湖确认该版本已完成转码；否则如实告知用户后继续 |
| `PREVIEW_UNAVAILABLE` | 预览图下载失败（retryable） | `lanhu preview "$URL" -o preview.png` 单独重试 |
| `TAILWIND_FALLBACK` | Tailwind 转换失败，保留原 HTML+CSS | 直接用原 CSS，或换 `--tw-version` 重试 |
| `ASSET_DOWNLOAD_FAILED` | 部分切图下载失败，其余已交付（retryable） | 重跑 `lanhu assets "$URL" --download`（幂等，只补失败项） |
