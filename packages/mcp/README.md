# @lanhu-context/mcp

> lanhu-context 的 MCP 兼容层：在 `@lanhu-context/core` 之上提供 `get_design_context` 工具，对外契约与上游 [lanhu-context-mcp](https://github.com/refinist/lanhu-context-mcp) 完全一致。

[仓库主页 / 完整文档](https://github.com/DaYePython/lanhu-context)

## 快速使用（推荐走 CLI）

最简单的方式是通过 [`@lanhu-context/cli`](https://www.npmjs.com/package/@lanhu-context/cli) 启动：

```bash
npx -y -p @lanhu-context/cli lanhu mcp --stdio                       # stdio（MCP 客户端拉起子进程）
npx -y -p @lanhu-context/cli lanhu mcp --http --port 5200            # streamable HTTP（POST /mcp）
```

MCP 客户端配置示例：

```json
{
  "mcpServers": {
    "lanhu-context": {
      "command": "npx",
      "args": ["-y", "-p", "@lanhu-context/cli", "lanhu", "mcp", "--stdio"],
      "env": { "LANHU_TOKEN": "<已登录 lanhuapp.com 的整段浏览器 Cookie>" }
    }
  }
}
```

## 与上游 lanhu-context-mcp 的关系

- **契约一致**：工具名 `get_design_context`、入参 `{url}`、inline/files 两种 mode、resource_link 返回、isError + STOP 错误文本——从上游 npm 包迁移即插即用。
- **默认行为差异**：附属阶段（tokens/preview/Tailwind 回退）失败不再整体报错，改为在返回文本末尾附 `warnings:` 段；传 `--compat-strict`（或 `compatStrict` 选项）可恢复上游"任一失败全停"语义。

迁移对照与排障见仓库 [skills/lanhu-context-mcp](https://github.com/DaYePython/lanhu-context/blob/main/skills/lanhu-context-mcp/SKILL.md)。

## 编程使用

```ts
import { createServer, startServer } from "@lanhu-context/mcp";
```

`createServer` 返回注册好 `get_design_context` 的 MCP server 实例；`startServer` 支持 stdio 与 streamable HTTP 两种 transport。

## 协议

MIT
