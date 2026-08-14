# @lanhu-context/cli

## 0.3.0

### Minor Changes

- 0a13f87: feat: M4 MCP 兼容层 —— `@lanhu-context/mcp` 首发与 `lanhu mcp` 命令
  
  - 新包 `@lanhu-context/mcp`：注册工具 `get_design_context`，对外契约与上游
    lanhu-context-mcp 完全一致（入参 `{url}`、inline/files 两种 mode、
    resource_link 返回、isError + STOP 错误文本）；导出
    `createServer`/`startServer`（stdio + streamable HTTP 两种 transport）。
  - 行为差异（DESIGN.md §9）：degraded 阶段失败（tokens/preview/Tailwind 回退）
    默认不再整体报错，在返回文本末尾附 `warnings:` 段；`compatStrict` 选项恢复
    上游"任一失败全停"语义。
  - CLI 新增 `lanhu mcp` 命令：`--stdio`（默认）/`--http`/`--host`/`--port`/
    `--mode <inline|files>`/`--out-dir`/`--compat-strict`，复用全局凭据与
    transform flags；stdio 模式 stdout 只承载 JSON-RPC 帧，日志走 stderr。
- 4e1ad0e: M3 全命令与幂等下载。
  
  `@lanhu-context/core`：新增并发幂等切图下载器 `downloadAssets`（worker pool 默认并发 4，内容 hash 三态 written/skipped/overwritten，单张失败逐条记录、`stopOnError` 首败即停），导出 `writeFileIdempotent`；Design Tokens 重构为结构化条目 `extractDesignTokenEntries` + CSS variables 格式化 `formatDesignTokensCss`（`:root { --var }`，legacy 文本输出保持不变）；`getDesignMeta` 附带 versions 摘要（count / latestHasSketchJson）；新增 degraded 错误码 `ASSET_DOWNLOAD_FAILED`；新增 fatal 错误码 `TRANSCODE_NOT_ENABLED`（exit 4）——设计稿上传时未开启「设计图转代码」时 DDS 返回 HTTP 200 + 空 data（业务码 10011 版本数据不存在），不再笼统归为 `EMPTY_RESULT`，hint 引导重新上传并勾选「设计图转代码」。
  
  `@lanhu-context/cli`：补齐全命令 `meta`（元数据报告）/ `tokens`（`--format json|css` 产物流，提取不到时空结果 + degraded 警告）/ `assets`（映射 JSON；`--download` 并发幂等下载、`--concurrency`、`-o <dir>`、`--dry-run`、`--force`、`--strict` 首败即停）/ `preview`（`-o <file>` 幂等落盘 + 报告，`-o -` 直出 PNG 二进制，`--json` 必须配 `-o <file>`，预览缺失为 degraded）/ `auth set|status|test`（用户级配置 0600、隐藏回显 / `--token-stdin`、来源 + 掩码指纹、活性检测）/ `doctor`（六项自检报告，失败按主导类别退出）。配置链扩展为 flag > env > env 文件 > lanhu.config.json（项目级）> 用户级 config.json（XDG：$XDG_CONFIG_HOME > ~/.config > %APPDATA%）> 默认值。

### Patch Changes

- Updated dependencies [0a13f87]
- Updated dependencies [4e1ad0e]
  - @lanhu-context/mcp@0.2.0
  - @lanhu-context/core@0.3.0

## 0.2.0

### Minor Changes

- 5a1a191: M1+M2 初始实现。
  
  `@lanhu-context/core`（M1）：从上游 lanhu-context-mcp 平移 url/api/transform/pipeline 数据链路（axios→ofetch），新增 `errors.ts` 分级严重性模型（code → exitClass/severity/retryable/hint）、`retry.ts` 指数退避重试（仅 retryable 错误）、HTTP 4xx 认证类拒绝分类（401/403/404/418 → exit 4 不重试，5xx/408/429 → exit 5 可重试）。
  
  `lanhu-context-cli`（M2）：citty CLI 骨架，双 bin `lanhu` / `lanhu-context`，四命令 `parse` / `schema` / `html`（`-` 支持 stdin 离线转换）/ `context`（`--inline` / `--out-dir` / `--force`）。全局 flags（token/timeout/retries/env-file/cwd/json/quiet/verbose/no-color/strict/lang 等）、§5 输出契约（stdout 只放数据/产物、报告类无 TTY 自动 `--json`、产物流原样直出、失败 envelope 走 stdout + 非零退出码）、§6 退出码 0-9 由 `LanhuError.exitClass` 驱动、flag > env > env 文件 > 默认值的配置层。

### Patch Changes

- Updated dependencies [5a1a191]
  - @lanhu-context/core@0.2.0
