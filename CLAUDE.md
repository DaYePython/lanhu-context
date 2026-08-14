# CLAUDE.md

lanhu-context：把蓝湖（Lanhu）设计稿 URL 转成 AI 可消费的前端实现上下文的管道式 CLI + MCP 兼容层。架构与设计决策的唯一权威来源是 [DESIGN.md](DESIGN.md)（管道阶段、错误模型、退出码、配置分层）——改行为前先读对应章节。

## 仓库结构

pnpm monorepo（pnpm 10，Node `^20.19.0 || >=22.12.0`）：

- `packages/core` —— `@lanhu-context/core`：纯逻辑（URL 解析、蓝湖 API client、schema→HTML、tokens、context 管道）。**零 CLI/MCP 依赖**，不得引入 citty/consola 等。
- `packages/cli` —— `@lanhu-context/cli`：`lanhu` / `lanhu-context` 二进制，citty 命令定义在 `src/commands/`，退出码在 `src/exit.ts`，参数解析在 `src/args.ts`。
- `packages/mcp` —— `@lanhu-context/mcp`：MCP 兼容层，自带 bin `lanhu-context-mcp`（`src/main.ts`），对外契约必须与上游 `lanhu-context-mcp` 的 `get_design_context` 保持一致。CLI 不依赖本包。
- `skills/` —— 面向 Agent 的 SKILL.md（发布物的一部分，改 CLI 行为后必须同步更新）。

## 常用命令

```bash
pnpm build        # 全部构建（vite）
pnpm test         # vitest run（根 vitest.config.ts）
pnpm typecheck
pnpm lint         # biome check .
pnpm lint:fix
```

单包测试：`pnpm vitest run packages/cli`。集成测试依赖 `.env.local`（见 `.env.local.example`）；`LANHU_TOKEN` 缺失时相关用例会跳过。

## 硬性约束

- **stdout 纪律**：CLI 命令 stdout 只放数据（`--json` 时是统一 envelope），日志/进度一律走 stderr；`lanhu-context-mcp --stdio`（@lanhu-context/mcp 的 bin）模式 stdout 只承载 JSON-RPC 帧。
- **错误模型**：三级严重性 fatal / degraded / notice + 分类退出码（见 DESIGN.md §6 与 `packages/cli/src/exit.ts`）。附属阶段（tokens/preview）失败必须降级为 warning，不得让整体失败。
- **token 安全**：`LANHU_TOKEN` 是整段浏览器 Cookie。绝不回显、绝不写入日志/测试快照/提交；示例统一用占位符。
- **幂等**：落盘命令重跑必须内容比对并报告 written/skipped/overwritten。
- **skills 同步**：命令、flag、退出码、envelope 字段的任何变更，同步修改 `skills/*/SKILL.md` 与 `skills/lanhu-context-cli/references/`。skills 写作规范：全中文、面向程序员、按退出码索引排障、命令配真实输出、术语不翻译。
- **发布**：用 changesets（`pnpm changeset`）；不要手改版本号。
