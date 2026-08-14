---
name: lanhu-context-cli
description: 蓝湖(Lanhu)设计稿转前端实现上下文 CLI（bin：lanhu / lanhu-context）。当用户给出 lanhuapp.com 设计稿 URL（含 tid/pid/image_id 参数）、要求"设计稿转代码/实现这个页面"、下载切图（slices）、提取 design tokens、或读取 DDS schema 时使用。也适用于批量导出多张设计稿与蓝湖凭据（LANHU_TOKEN Cookie）排障。不适用于：Figma、Sketch、MasterGo 等其他设计平台；没有设计稿 URL 的纯视觉/UI 讨论；MCP 客户端配置与 MCP server 启动（那是 skills/lanhu-context-mcp 的场景）。
---

# lanhu-context-cli：蓝湖设计稿 → 前端实现上下文

CLI 命令：`lanhu`（等价全名 `lanhu-context`），由 npm 包 `@lanhu-context/cli` 提供。未全局安装时可用 npx 免安装运行：

```bash
npx -y -p @lanhu-context/cli lanhu --help
```

下文统一写 `lanhu`；使用 npx 时替换为 `npx -y -p @lanhu-context/cli lanhu` 即可。

## 执行边界（先读）

1. **一律带 `--json`，解析 envelope，不抓自由文本。** 判定顺序：退出码 → `ok` / `error.code` → `warnings[]`。成功与失败的 envelope 都走 stdout，失败的第一信号是非零退出码。
2. **token 绝不回显。** LANHU_TOKEN 是整段浏览器 Cookie；凭据问题只引导用户运行 `lanhu auth set`（或写 `<cwd>/.env.local`），不要把 token 打进命令行参数、日志或答复。
3. **degraded 不算失败。** 退出码 0 + `warnings[]`（如 `TOKENS_UNAVAILABLE`、`PREVIEW_UNAVAILABLE`）表示核心产物 OK、附属产物缺失——继续干活，但必须在答复中如实告知用户缺了什么，不要虚构缺失的数据。
4. **幂等，放心重跑。** `context` / `assets --download` / `preview -o` 按内容 hash 比对：一致 skipped、不一致 overwritten、新文件 written；`--force` 强制重写。
5. **优先原子命令按需取数据。** 只要 ID 用 `parse`，只要布局用 `html --skip-slices`，只要 tokens 用 `tokens`——别每次都跑完整 `context`（省时间与上下文窗口）。
6. **产物落盘用 `.local` 目录**（默认 `--out-dir` 为 `<cwd>/.lanhu.local`），避免产物进 git。

两条硬性用法约束（违反直接 exit 2 / `USAGE_ERROR`）：`context --inline` 与 `--json`/`--stdin` 互斥；`preview --json` 必须配 `-o <file>`（`-o -` 是 PNG 二进制通道）。

---

## 场景 1：从设计稿实现页面（默认路径）

输入：一条 lanhuapp.com 设计稿 URL + 目标项目代码库。

```bash
# 1. 活性检测（token 是否有效；URL 缺省时回退 LANHU_TEST_URL 环境变量）
lanhu auth test "$URL" --json
# → exit 0：{"ok":true,...,"data":{"ok":true,"design":{"name":"首页-数据大屏",...}}}
# → exit 3/4：见场景 5，先解决凭据再继续

# 2. 读目标项目，判断是否用 Tailwind（看 tailwind.config.* / package.json）

# 3. 生成完整上下文（Tailwind 项目加 --tailwind --tw-version <3|4>）
lanhu context "$URL" --json --out-dir .lanhu.local
```

exit 0 时 stdout envelope（真实输出，路径缩略）：

```json
{"ok":true,"command":"context","data":{"designName":"首页-数据大屏","imageId":"a1b2c3d4-…","dir":"…/.lanhu.local/首页-数据大屏-a1b2c3d4","files":[{"path":"…/context.md","type":"context","bytes":76010,"status":"written"},{"path":"…/preview.png","type":"preview","bytes":439128,"status":"written"}],"assets":{"total":45,"downloaded":0,"mappingIncluded":true}},"warnings":[],"meta":{"version":"0.2.0","durationMs":2314}}
```

```bash
# 4. 读 data.files 里的 context.md（结构：HTML+CSS 代码 → 切图映射 45 条 → 实现指引）

# 5. 下载切图到项目资产目录（-o 同时决定映射里的本地路径前缀）
lanhu assets "$URL" --download -o src/assets/<语义化页面名> --json
# → "summary":{"total":45,"written":45,"skipped":0,"overwritten":0,"failed":0}

# 6. 按 context.md + 项目技术栈写业务代码（图片路径与 -o 目录对齐；图片命名改语义化）
```

失败分支：步骤 3/5 非零退出码 → 按场景 5 分派；`warnings[]` 里有 `TOKENS_UNAVAILABLE`/`PREVIEW_UNAVAILABLE` → 继续实现，答复中说明缺失项。

## 场景 2：只分析布局结构（不落盘）

输入：URL，只想看层级/布局，不需要图片资产。

```bash
lanhu html "$URL" --skip-slices
```

- stdout 直出 HTML+CSS（产物流，无 TTY 也原样输出，可直接进上下文或 `> page.html`）；本次实测 67 KB、exit 0。
- `--skip-slices` 跳过切图定位与本地映射，图片引用保持蓝湖 OSS 远程 URL——纯布局分析不需要下载任何东西。
- 2x 稿要 1x 尺寸时加 `--unit-scale 0.5`。

## 场景 3：建立/核对设计系统

输入：URL + 项目现有 CSS 变量文件。

```bash
lanhu tokens "$URL" --format css > /tmp/lanhu-tokens.css
diff /tmp/lanhu-tokens.css src/styles/design-tokens.css
```

- 提取到 tokens：stdout 输出 `:root { --var: … }`，与项目变量 diff 后给出差异结论。
- **提取不到 tokens（常见）**：stdout 输出 `:root {}`、stderr `WARN TOKENS_UNAVAILABLE`、exit 0（degraded）——如实告知"该设计稿无可提取的高风险 token"，不要编造变量；`--strict` 下会变成 exit 8。
- 要结构化条目走 `lanhu tokens "$URL" --json`，看 `data.count` / `data.tokens[]`。

## 场景 4：批量导出多张设计稿

输入：URL 列表文件（每行一条 URL，或 NDJSON `{"url":...}`）。

```bash
cat urls.txt | lanhu context --stdin --keep-going --json --out-dir .lanhu.local > report.ndjson
echo "exit=$?"   # 0 全成功；9 部分失败；全失败取主导错误类别码
```

消费纪律：**逐行解析 NDJSON**，每行是完整 envelope + `input` 回显字段；stderr 有汇总 `batch: {"total":2,"ok":1,"failed":1}`。

```bash
jq -c 'select(.ok == false) | {input, code: .error.code}' report.ndjson   # 定位失败条目
```

exit 9 处理：只重跑失败条目（把 `ok:false` 行的 `input` 重新喂给 `--stdin`）；成功条目已落盘且幂等，重跑也只会 skipped。不加 `--keep-going` 时首败即停。

注意：`--stdin` 批处理只有 `parse` / `meta` / `context` 支持。

## 场景 5：排障（按退出码分派）

先看退出码，再看 `error.code`，按表执行动作；完整索引见 [references/troubleshooting.md](references/troubleshooting.md)。

| 退出码 | 典型 error.code | 动作 |
| --- | --- | --- |
| 2 | `URL_MISSING_TID` / `URL_MISSING_PID` / `URL_MISSING_IMAGE_ID` / `USAGE_ERROR` | 检查 URL 是否含 tid/pid/image_id 三参数（从浏览器地址栏复制完整 URL）；`USAGE_ERROR` 按 message 修正 flag 组合 |
| 3 | `TOKEN_MISSING` / `CONFIG_INVALID` | 引导用户 `lanhu auth set` 或写 `<cwd>/.env.local`；核对 `--cwd`/`--env-file` 路径 |
| 4 | `AUTH_EXPIRED` / `ACCESS_DENIED` / `EMPTY_RESULT` | `lanhu auth test "$URL" --json` 复核；过期则引导重新登录蓝湖取 Cookie → `lanhu auth set`；`EMPTY_RESULT` 先验 token 再核对 URL 完整性 |
| 5 | `UPSTREAM_TIMEOUT` / `UPSTREAM_ERROR` / `SCHEMA_FIELD_MISSING` | retryable：加 `--retries 3` / 调大 `--timeout`；`SCHEMA_FIELD_MISSING` 是设计稿未转码完成，引导在蓝湖重新处理 |
| 8 | `--strict` 升级的 warning | 看 stderr 列出的 warning 码；确属可接受降级则去掉 `--strict` 重跑 |
| 9 | `BATCH_PARTIAL` | 逐行解析 NDJSON 找 `ok:false` 行，按其 `error.code` 递归分派 |
| 1/6/7 | `UNKNOWN` / `TRANSFORM_FAILED` / `IO_WRITE_FAILED` | `lanhu doctor --json` 环境自检；7 检查目录可写与磁盘空间；6 落盘 schema 复查（`lanhu schema "$URL" > page.schema.json`） |

对 URL/权限/token 类错误（exit 2/3/4）**绝不重试**——重试绕不过凭据问题。

---

## 更多资料

- 全命令/flags/退出码/配置优先级：[references/cli-reference.md](references/cli-reference.md)
- 管道配方（schema 落盘离线转换、NDJSON 消费、`--inline` 接下游 AI 等）：[references/pipeline.md](references/pipeline.md)
- 按退出码排障索引：[references/troubleshooting.md](references/troubleshooting.md)
- MCP 场景（MCP 客户端配置、`lanhu mcp` server、自上游 lanhu-context-mcp 迁移）：见 `skills/lanhu-context-mcp`，不在本技能范围。
