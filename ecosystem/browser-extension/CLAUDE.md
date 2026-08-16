# CLAUDE.md — @lanhu-context/browser-extension

蓝湖设计稿详情页（detailDetach）的 Chrome MV3 扩展：往蓝湖**自绘**的右键菜单注入「复制选中设计稿链接 / 复制 cookies / 发送 cookies 到本机」三项，配合 CLI 的 `lanhu auth listen` 使用。私有包（`private: true`），不发布 npm，不参与 changesets 发版。

## 权威文档

- [docs/NOTES.md](docs/NOTES.md) —— 真机侦察记录（菜单项 outerHTML、`tid` 丢弃行为等实测事实的唯一来源）
- [docs/implementation-plan.md](docs/implementation-plan.md) —— 实施计划存档；蓝湖改版导致注入失效时，按其 Task 1 折叠区「侦察方法留档」重测
- [README.md](README.md) —— 面向用户的安装与使用说明

## 架构（两层，无 MAIN world）

- **content script**（`src/content/`，ISOLATED world，IIFE 产物）：注入菜单 + 解析设计稿参数 + 剪贴板。蓝湖对原生右键菜单做了 `preventDefault`，所以 `chrome.contextMenus` 在画布区不可用，只能 DOM 注入。
- **service worker**（`src/background/`，ES module 产物）：用 `chrome.cookies` 取完整 Cookie（含 HttpOnly——这是做成扩展而非油猴脚本的原因）并 POST 到 `http://127.0.0.1:<port>/token`。
- 两层通过 `src/shared/protocol.ts` 的消息类型通信；纯函数放 `src/shared/`。

## 常用命令

```bash
pnpm --filter @lanhu-context/browser-extension build      # 双入口构建 → dist/（SW=ES、content=IIFE，scripts/build.ts 驱动）
pnpm --filter @lanhu-context/browser-extension typecheck
pnpm vitest run ecosystem/browser-extension               # 测试由根 vitest.config.ts 收录；DOM 测试用 @vitest-environment jsdom
```

构建后在 `chrome://extensions` 开发者模式加载 `dist/`；改代码后需重新 build 并点扩展的刷新按钮。

## 硬性约束

- **禁止打开/读取/grep 仓库根的 `lhcdn.lanhuapp.com.local/`**。那是蓝湖前端 bundle 的本地镜像与反混淆产物，仅供历史调研；页面事实一律以 docs/NOTES.md 与真机实测为准，两者冲突时以实测为准并回写 NOTES.md。
- **`src/content/selectors.ts` 是所有 DOM 代码的唯一依据**，每个选择器都来自真机实测（muse-ui 类名随蓝湖构建变化，不得凭源码推断）。改选择器只改这个文件，业务逻辑不动。
- **菜单注入的三条实测铁律**（违反会静默坏掉）：① 列表容器是 `.mu-menu-list` 不是 `.mu-menu`；② 菜单项必须复刻 5 层嵌套（`wrapper > div > ripple + item > title-box > title`），扁平近似会渲染成无样式裸文本；③ 注入项必须 `stopPropagation()` 掉 `mouseup`——宿主收到冒泡的 mouseup 会在 `click` 触发前关闭菜单。
- **菜单每次右键都是新建再销毁**，注入靠 MutationObserver 持续观察（`installMenuInjector`），不能只跑一次。
- **设计稿参数取值链**：URL hash 优先 → `localStorage` 兜底（蓝湖的 `changeUrlQuery` 切稿时会把 `tid` 从 URL 抹掉；蓝湖还会往 storage 写字面量 `"undefined"`/`"null"`，必须过滤）。`imageId` 刻意无存储兜底——陈旧值会静默指向错误设计稿。见 `src/shared/url.ts` 注释。
- **命名空间**：本扩展的 DOM 标记一律 `data-lanhu-ext-*`。现场可能存在第三方注入器（`data-lanhu-helper-*`），不检测、不移除、不复用其节点。
- **不自带 CSS**：注入项复用宿主已有 class 继承样式；toast 等临时元素用内联样式。
- **端口一致性**：`src/shared/constants.ts` 的 `DEFAULT_BRIDGE_PORT = 7623` 必须与 CLI `lanhu auth listen --port` 默认值一致，改一处必改另一处（`packages/cli/src/commands/auth.ts`）。
- **token 安全**（继承根 CLAUDE.md）：Cookie 等同账号凭据。测试与文档一律用 `sid=FAKE` 类占位符，绝不出现真实 Cookie；日志/toast 不回显 token 内容。
- **manifest 权限最小化**：`cookies` + `clipboardWrite`，`host_permissions` 仅 `*.lanhuapp.com` 与 `127.0.0.1`；新增权限需先在 README「权限说明」给出理由。
