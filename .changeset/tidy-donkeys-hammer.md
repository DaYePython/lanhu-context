---
'@lanhu-context/core': minor
'@lanhu-context/cli': minor
---

M3 全命令、批处理与幂等下载。

`@lanhu-context/core`：新增并发幂等切图下载器 `downloadAssets`（worker pool 默认并发 4，内容 hash 三态 written/skipped/overwritten，单张失败逐条记录、`stopOnError` 首败即停），导出 `writeFileIdempotent`；Design Tokens 重构为结构化条目 `extractDesignTokenEntries` + CSS variables 格式化 `formatDesignTokensCss`（`:root { --var }`，legacy 文本输出保持不变）；`getDesignMeta` 附带 versions 摘要（count / latestHasSketchJson）；新增 degraded 错误码 `ASSET_DOWNLOAD_FAILED`。

`@lanhu-context/cli`：补齐全命令 `meta`（元数据报告）/ `tokens`（`--format json|css` 产物流，提取不到时空结果 + degraded 警告）/ `assets`（映射 JSON；`--download` 并发幂等下载、`--concurrency`、`-o <dir>`、`--dry-run`、`--force`、`--strict` 首败即停）/ `preview`（`-o <file>` 幂等落盘 + 报告，`-o -` 直出 PNG 二进制，`--json` 必须配 `-o <file>`，预览缺失为 degraded）/ `auth set|status|test`（用户级配置 0600、隐藏回显 / `--token-stdin`、来源 + 掩码指纹、活性检测）/ `doctor`（六项自检报告，失败按主导类别退出）。`--stdin` 批处理（parse/meta/context）：逐行 URL 或 NDJSON，stdout 每行完整 envelope + input 回显，stderr 汇总 {total, ok, failed}，默认首败即停、`--keep-going` 部分失败退出码 9（BATCH_PARTIAL）、全失败取主导错误类别。配置链扩展为 flag > env > env 文件 > lanhu.config.json（项目级）> 用户级 config.json（XDG：$XDG_CONFIG_HOME > ~/.config > %APPDATA%）> 默认值。
