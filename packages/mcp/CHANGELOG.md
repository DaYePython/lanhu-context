# @lanhu-context/mcp

## 0.3.0

### Minor Changes

- d3bcbdc: refactor: MCP server 从 CLI 拆出，@lanhu-context/mcp 自带 bin
  
  - `@lanhu-context/mcp` 新增 bin `lanhu-context-mcp`（`npx -y @lanhu-context/mcp --stdio|--http`）：flags 覆盖 transport（--stdio/--http/--host/--port）、工具行为（--mode/--out-dir/--compat-strict/--lang/--tailwind/--tw-version/--skip-slices/--unit-scale/--assets-dir）与凭据（env LANHU_TOKEN/DDS_TOKEN > --env-file > <cwd>/.env.local）；USAGE_ERROR exit 2、TOKEN_MISSING exit 4。
  - `@lanhu-context/cli` 移除 `lanhu mcp` 子命令与对 `@lanhu-context/mcp` 的依赖——安装 CLI 不再拉取 MCP SDK 依赖链；MCP 场景改用 `lanhu-context-mcp` 启动。

## 0.2.1

### Patch Changes

- 8b3a2d0: docs: 为三个包新增 npm README（安装、命令/能力概览、MCP 客户端配置与上游迁移说明）
- Updated dependencies [8b3a2d0]
  - @lanhu-context/core@0.3.1

## 0.2.0

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

### Patch Changes

- Updated dependencies [4e1ad0e]
  - @lanhu-context/core@0.3.0
