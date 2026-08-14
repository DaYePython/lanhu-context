# @lanhu-context/core

## 0.2.0

### Minor Changes

- 5a1a191: M1+M2 初始实现。
  
  `@lanhu-context/core`（M1）：从上游 lanhu-context-mcp 平移 url/api/transform/pipeline 数据链路（axios→ofetch），新增 `errors.ts` 分级严重性模型（code → exitClass/severity/retryable/hint）、`retry.ts` 指数退避重试（仅 retryable 错误）、HTTP 4xx 认证类拒绝分类（401/403/404/418 → exit 4 不重试，5xx/408/429 → exit 5 可重试）。
  
  `lanhu-context-cli`（M2）：citty CLI 骨架，双 bin `lanhu` / `lanhu-context`，四命令 `parse` / `schema` / `html`（`-` 支持 stdin 离线转换）/ `context`（`--inline` / `--out-dir` / `--force`）。全局 flags（token/timeout/retries/env-file/cwd/json/quiet/verbose/no-color/strict/lang 等）、§5 输出契约（stdout 只放数据/产物、报告类无 TTY 自动 `--json`、产物流原样直出、失败 envelope 走 stdout + 非零退出码）、§6 退出码 0-9 由 `LanhuError.exitClass` 驱动、flag > env > env 文件 > 默认值的配置层。
