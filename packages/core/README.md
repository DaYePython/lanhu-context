# @lanhu-context/core

> lanhu-context 的纯逻辑核心：URL 解析、蓝湖 API client、DDS schema→HTML、design tokens、context 管道。零 CLI/MCP 依赖。

[仓库主页 / 完整文档](https://github.com/DaYePython/lanhu-context)

一般情况下你不需要直接安装本包——终端使用请装 [`@lanhu-context/cli`](https://www.npmjs.com/package/@lanhu-context/cli)，MCP 客户端集成请看 [`@lanhu-context/mcp`](https://www.npmjs.com/package/@lanhu-context/mcp)。本包面向想在自己的 Node.js 程序里嵌入蓝湖设计稿处理链路的开发者。

## 安装

```bash
npm i @lanhu-context/core
```

## 提供的能力

- **URL 解析** —— `lanhuapp.com` 设计稿详情 URL → `{ teamId, projectId, docId }`
- **蓝湖 API client** —— 主站 + DDS 两套 client（Cookie 凭据、浏览器伪装、HTTP 200 空 payload 业务错误识别）
- **schema→HTML** —— DDS schema 渲染 HTML+CSS，可选 css-to-tailwind（v3/v4）转换与失败回退
- **Design tokens** —— 从 Sketch JSON 提取结构化 token 条目，支持 CSS variables 格式化输出
- **切图下载** —— 并发幂等下载器（内容 hash 三态 written/skipped/overwritten）
- **context 管道** —— 组装 `context.md`（HTML 代码 + 切图映射 + tokens + 实现指引）与预览图
- **分级错误模型** —— `fatal` / `degraded` / `notice` 三级严重性 + 结构化错误码 `{code, severity, message, hint}`

## 协议

MIT
