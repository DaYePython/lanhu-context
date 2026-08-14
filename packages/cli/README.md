# @lanhu-context/cli

> 把蓝湖（Lanhu）设计稿 URL 转成 AI 可直接消费的前端实现上下文——管道式 CLI，bin：`lanhu` / `lanhu-context`。MCP server 见 [`@lanhu-context/mcp`](https://www.npmjs.com/package/@lanhu-context/mcp)。

[仓库主页 / 完整文档](https://github.com/DaYePython/lanhu-context)（[English](https://github.com/DaYePython/lanhu-context/blob/main/README.md)）

## 安装

```bash
npm i -g @lanhu-context/cli
lanhu doctor        # 自检环境/凭据，exit 0 = 就绪
```

凭据配置（`LANHU_TOKEN` 是已登录 lanhuapp.com 会话的整段浏览器 Cookie）：

```bash
lanhu auth set
lanhu auth test "$URL"   # exit 0 = token 有效
```

## 命令

| 命令 | 用途 |
| --- | --- |
| `parse` / `meta` / `schema` | 解析 URL ID / 设计稿元数据 / DDS schema |
| `html` | 渲染 HTML+CSS（可选 `--tailwind --tw-version <3\|4>`） |
| `tokens` | 提取 design tokens（`--format json\|css`） |
| `assets` | 切图映射；`--download` 并发幂等下载 |
| `preview` | 预览图（`-o <file>` 落盘 / `-o -` 直出 PNG） |
| `context` | 一键组装 `context.md` + `preview.png` |
| `auth` / `doctor` | 凭据管理与六项自检 |

## 用法示例

```bash
lanhu context "https://lanhuapp.com/web/#/item/project/detailDetach?tid=...&pid=...&image_id=..." \
  --json --out-dir .lanhu.local

lanhu assets "$URL" --download -o src/assets/my-page --json
```

约定：`--json` 输出统一 envelope（`ok`/`data`/`error`/`warnings`/`meta`）+ 分类退出码；附属阶段（tokens/preview）失败降级为 warning 不拖垮核心产物；落盘幂等（written/skipped/overwritten）。

面向 AI Agent 的完整用法（skills、排障、退出码索引）见仓库 [skills/lanhu-context-cli](https://github.com/DaYePython/lanhu-context/tree/main/skills/lanhu-context-cli)。

## 协议

MIT
