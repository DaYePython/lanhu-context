---
'@lanhu-context/cli': minor
'@lanhu-context/mcp': minor
---

refactor: MCP server 从 CLI 拆出，@lanhu-context/mcp 自带 bin

- `@lanhu-context/mcp` 新增 bin `lanhu-context-mcp`（`npx -y @lanhu-context/mcp --stdio|--http`）：flags 覆盖 transport（--stdio/--http/--host/--port）、工具行为（--mode/--out-dir/--compat-strict/--lang/--tailwind/--tw-version/--skip-slices/--unit-scale/--assets-dir）与凭据（env LANHU_TOKEN/DDS_TOKEN > --env-file > <cwd>/.env.local）；USAGE_ERROR exit 2、TOKEN_MISSING exit 4。
- `@lanhu-context/cli` 移除 `lanhu mcp` 子命令与对 `@lanhu-context/mcp` 的依赖——安装 CLI 不再拉取 MCP SDK 依赖链；MCP 场景改用 `lanhu-context-mcp` 启动。
