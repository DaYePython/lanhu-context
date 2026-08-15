# lanhu-context

> 把蓝湖（Lanhu）设计稿 URL 转成 AI 可直接消费的前端实现上下文——为 AI Agent 与 shell 自动化设计的管道式 CLI，附带 MCP 兼容层。

[English](README.md) | [简体中文](README.zh.md)

`lanhu-context` 接收一条 `lanhuapp.com` 设计稿详情 URL，把"设计稿 → 代码"链路拆成一组可独立调用、可管道组合的小命令：解析 ID、拉取元数据、获取 DDS schema、渲染 HTML+CSS（可选 Tailwind v3/v4）、提取 design tokens、下载切图、获取预览图，或一键组装成 `context.md` 交给 AI 实现页面。

## 特性

- **原子命令、可管道组合** —— `parse` / `meta` / `schema` / `html` / `tokens` / `assets` / `preview` / `context`，每个命令只做一件事；stdout 只放数据。
- **默认机器可读** —— `--json` 输出统一 envelope（`ok` / `data` / `error` / `warnings` / `meta`）+ 分类退出码；错误结构化为 `{code, severity, message, hint}`。
- **分级严重性** —— tokens / preview 等附属阶段失败只降级为 warning，不拖垮核心产物（`fatal` / `degraded` / `notice` 三级）。
- **幂等输出** —— 重跑会比对文件内容并报告 `written` / `skipped` / `overwritten`；`--force` 强制重写。
- **凭据工具链** —— `lanhu auth set/test` 与 `lanhu doctor` 管理和诊断 token（整段浏览器 Cookie）；token 绝不回显。
- **MCP 兼容** —— 独立 bin `lanhu-context-mcp`（npm 包 `@lanhu-context/mcp`）以 stdio 或 streamable HTTP 提供与上游完全一致的 `get_design_context` 工具契约。
- **自带 Agent skills** —— [skills/](skills/) 内置两个 skill，教 Claude Code 等 Agent 正确驱动 CLI 与 MCP server。

## 安装

### 方式一：交给 AI Agent（推荐）

按安装范围二选一，把整段话交给任意支持本仓库的 AI 客户端（Codex / Claude Code / Cursor / Hermes / Trae / Qoder 等），由它自行完成 CLI 安装 + skill 接入。

**全局安装**（CLI 命令全局可用，skill 装到用户级/全局技能目录，所有项目共享）：

```text
请为我全局安装 lanhu-context（不要 clone 任何源码仓库）：
1. npm i -g @lanhu-context/cli，然后运行 lanhu doctor 直到退出码为 0（凭据问题用 lanhu auth set 配置 LANHU_TOKEN）；
2. 运行 npx -y skills add dayepython/lanhu-context -s lanhu-context-cli -g -y 全局安装 skill；如果该方式不适用于你，就把 lanhu-context-cli skill 装到你自己的全局技能/规则目录（如 Claude Code 的 ~/.claude/skills、Codex 的 ~/.codex/AGENTS.md 等）；
3. 安装后向我汇报 doctor 结果和 skill 安装位置。
```

**项目级安装**（CLI 装为当前项目 devDependency，skill 只对本项目生效；CLI 不在全局 PATH，执行命令需带前缀）：

```text
请在当前项目内安装 lanhu-context（不要 clone 任何源码仓库，不要全局安装）：
1. npm i -D @lanhu-context/cli；之后所有 lanhu 命令都要带前缀执行：npx lanhu <command>（或封装进 package.json scripts 后用 npm run 调用）；
2. 运行 npx lanhu doctor 直到退出码为 0（凭据问题用 npx lanhu auth set 配置 LANHU_TOKEN，写入项目 .env.local 并确认已被 gitignore）；
3. 运行 npx -y skills add dayepython/lanhu-context -s lanhu-context-cli -y 安装 skill（默认即项目级）；如果该方式不适用于你，就把 lanhu-context-cli skill 装到本项目的技能/规则目录（如 .claude/skills、.cursor/rules 等），并在 skill 用法中注明命令需用 npx lanhu 前缀；
4. 安装后向我汇报 doctor 结果和 skill 安装位置。
```

### 方式二：手动安装

安装 CLI 并跑通自检：

```bash
npm i -g @lanhu-context/cli
lanhu doctor        # 自检环境/凭据，exit 0 = 就绪
```

`doctor` 报凭据问题时，配置蓝湖凭据（`LANHU_TOKEN` 是已登录 lanhuapp.com 会话的整段浏览器 Cookie 请求头）后重跑：

```bash
lanhu auth set          # 从 stdin 读 token，不落命令行
lanhu auth test "$URL"  # exit 0 = token 有效
```

要让 Agent 学会驱动 CLI，用 [find-skills](https://github.com/vercel-labs/skills) 把本仓的 lanhu-context-cli skill 装到你的 Agent（默认项目级，加 `-g` 全局安装；`-a <agent>` 指定目标 agent，部分 agent 不支持全局安装会标 ✗ 跳过）：

```bash
npx -y skills add \
  dayepython/lanhu-context \
  -s lanhu-context-cli \
  -y
```

## 快速上手

生成设计稿实现上下文：

```bash
lanhu context "https://lanhuapp.com/web/#/item/project/detailDetach?tid=...&pid=...&image_id=..." \
  --json --out-dir .lanhu.local
```

产物落在 `<out-dir>/<设计稿名>-<imageId前8位>/{context.md, preview.png}`——含 HTML+CSS 代码、切图映射、design tokens 与实现指引。把切图下载进项目：

```bash
lanhu assets "$URL" --download -o src/assets/my-page --json
```

只需要部分数据时优先用原子命令：只要布局用 `lanhu html "$URL" --skip-slices`，只要 tokens 用 `lanhu tokens "$URL"`。

MCP 客户端场景：运行 `npx -y @lanhu-context/mcp --stdio`（bin 名 `lanhu-context-mcp`，也支持 `--http`）并在客户端注册；从上游 `lanhu-context-mcp` npm 包迁移是即插即用的，见 [skills/lanhu-context-mcp/SKILL.md](skills/lanhu-context-mcp/SKILL.md)。配套的 agent skill 用 `npx -y skills add dayepython/lanhu-context -s lanhu-context-mcp -y` 安装（全局安装加 `-g`）。

## 包结构

| 包 | 说明 |
| --- | --- |
| [`@lanhu-context/cli`](packages/cli) | `lanhu` / `lanhu-context` 可执行命令：全部管道命令 + `auth` / `doctor` / `mcp` |
| [`@lanhu-context/core`](packages/core) | 纯逻辑：URL 解析、蓝湖 API client、schema→HTML、design tokens、context 管道 |
| [`@lanhu-context/mcp`](packages/mcp) | MCP 兼容层，在 core 之上提供 `get_design_context` |

## 开发

需要 Node `^20.19.0 || >=22.12.0` 与 pnpm 10。

```bash
pnpm install
pnpm build       # 构建所有包
pnpm test        # vitest
pnpm typecheck
pnpm lint        # biome
```

完整架构（管道阶段、错误模型、退出码、配置分层）见 [DESIGN.md](DESIGN.md)。

## 协议

[MIT](LICENSE)

## 特别鸣谢

本项目源自并保持与 [refinist/lanhu-context-mcp](https://github.com/refinist/lanhu-context-mcp) 的工具契约兼容——特别感谢原作者打通了设计稿到上下文的端到端链路，让这个 CLI 成为可能。❤️
