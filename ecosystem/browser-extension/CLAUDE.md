# CLAUDE.md — @lanhu-context/browser-extension

蓝湖设计稿详情页（detailDetach）与项目画布页（stage）的 Chrome MV3 扩展：往两页各自**自绘**的右键菜单注入「复制选中设计稿链接 / 复制 cookies / 发送 cookies 到本机」三项，配合 CLI 的 `lanhu auth listen` 使用。私有包（`private: true`），不发布 npm，但**参与 changesets 发版**（`.changeset/config.json` 的 `privatePackages` 开启 version+tag）：发版打 tag `@lanhu-context/browser-extension@x.y.z`，CI（`.github/workflows/release-extension.yml`，由 release.yml 以 `workflow_call` 调用）把签名 crx + zip 附到该 tag 的 GitHub Release。

## 与 ecosystem-core / lanhu-monkey 的关系

**菜单注入、文案、URL 解析构建、Cookie 序列化、桥接封装等全部业务逻辑在 [`../ecosystem-core`](../ecosystem-core/CLAUDE.md)**（以 `dependencies` 引入、构建时打进产物）；姊妹实现 [`../lanhu-monkey`](../lanhu-monkey/CLAUDE.md)（油猴脚本）复用同一实现。一致性契约见 core 的 CLAUDE.md：功能/文案变更改 core，本包只维护平台适配器；**禁止在本包复制 core 已有逻辑**。平台无关的硬约束（实测选择器唯一依据、两页菜单注入铁律、参数取值链等）也随代码迁至 core 的 CLAUDE.md，改注入行为前先读那份。

## 架构（两层 + 共享层，无 MAIN world）

- **content script**（`src/content/`，ISOLATED world，IIFE 产物）：`index.ts` 是薄接线——用 `ask()`（`messaging.ts`）把 core 的 `MenuPlatform` 三个适配器桥到 service worker，然后调 core 的 `installLanhuContextMenu`。蓝湖在两页都对原生右键菜单做了 `preventDefault`，所以 `chrome.contextMenus` 不可用，只能 DOM 注入（注入逻辑在 core）。
- **service worker**（`src/background/`，ES module 产物）：用 `chrome.cookies` 取完整 Cookie（含 HttpOnly——这是扩展相对油猴脚本的保真度优势：油猴的 GM_cookie 需要用户手动开设置才能读 HttpOnly）并经 core 的 `sendCookieHeader` POST 到 `http://127.0.0.1:<port>/token`。
- 两层通过 `src/shared/protocol.ts` 的消息类型通信。

## 常用命令

```bash
pnpm --filter @lanhu-context/browser-extension build      # 双入口构建 → dist/（SW=ES、content=IIFE，scripts/build.ts 驱动；版本号从 package.json 注入 dist/manifest.json）
pnpm --filter @lanhu-context/browser-extension pack:crx   # dist/ → artifacts/ 下 crx+zip（key 缺省 key.pem，不存在时自动生成；需 Node 22+）
pnpm --filter @lanhu-context/browser-extension typecheck
pnpm vitest run ecosystem/browser-extension               # 本包仅剩消息层测试；注入/URL/桥接测试随代码在 ecosystem/ecosystem-core
```

构建后在 `chrome://extensions` 开发者模式加载 `dist/`；改代码后需重新 build 并点扩展的刷新按钮。改 core 后同样要重新 build 本包。

## 硬性约束（chrome 特有部分）

- **平台无关约束在 core**：选择器、菜单注入铁律、取值链、`data-lanhu-ext-*` 命名空间等见 [`../ecosystem-core/CLAUDE.md`](../ecosystem-core/CLAUDE.md)；蓝湖改版导致注入失效时按 [docs/implementation-plan.md](docs/implementation-plan.md) / [docs/implementation-plan-stage-menu.md](docs/implementation-plan-stage-menu.md) Task 1 折叠区的方法重测，改的是 core 里的选择器文件。
- **端口一致性**：`../ecosystem-core/src/constants.ts` 的 `DEFAULT_BRIDGE_PORT = 7623` 必须与 CLI `lanhu auth listen --port` 默认值一致，改一处必改另一处（`packages/cli/src/commands/auth.ts`）。
- **token 安全**（继承根 CLAUDE.md）：整段 Cookie 等同账号凭据。测试与文档一律用 `sid=FAKE` 类占位符，绝不出现真实 Cookie；日志/toast 不回显 token 内容。
- **crx 签名 key 同凭据级**：key 决定扩展 ID，换 key 等于换扩展。本地 `key.pem` 与一切 `*.pem`/`*.crx` 已被根 .gitignore 拦截，绝不入库；CI 从 repo secret `LANHU_EXT_CRX_KEY` 读取（缺失时 workflow 明确报错，不静默跳过）。manifest 版本号唯一事实源是 package.json（changesets 管理），`public/manifest.json` 里的 version 只是占位，构建时被 `scripts/build.ts` 覆写。
- **manifest 权限最小化**：`cookies` + `clipboardWrite`，`host_permissions` 仅 `*.lanhuapp.com` 与 `127.0.0.1`；新增权限需先在 README「权限说明」给出理由。
- **`host_permissions` 的 `http://*.lanhuapp.com/*` 不是冗余，删了会静默丢 Cookie**：Chrome 按 Cookie 的 `Secure` 标志拼 URL 再匹配 host_permissions（Secure→`https://`，非 Secure→`http://`）。蓝湖只有 `PASSPORT` 是 Secure，`user_token`/`session`/`SERVERID` 都不是——只留 https 时 `chrome.cookies.getAll` 只返回 `PASSPORT` 一条且不报错（2026-08 实测）。油猴无此问题是因为 Tampermonkey 自带全站权限。
- **Cookie 采集是两个来源合并**：service worker 的 `chrome.cookies`（唯一能拿 HttpOnly 的来源）+ content script 随消息带上的 `document.cookie`（`BackgroundMessage.pageCookie`），在 core 的 `mergeCookies` 里同名以前者为准。保留页面这一路的意义：权限或分区导致特权查询变窄时，扩展至少不会比页面本身能发出的 Cookie 还少。

## 权威文档

- [docs/NOTES.md](docs/NOTES.md) —— 真机侦察记录（菜单 DOM、`tid` 丢弃行为、stage 页导航树反查等实测事实的唯一来源；core 的选择器文件即来源于此）
- [docs/implementation-plan.md](docs/implementation-plan.md) / [docs/implementation-plan-stage-menu.md](docs/implementation-plan-stage-menu.md) —— 详情页 / stage 页实施计划存档与重测方法
- [README.md](README.md) —— 面向用户的安装与使用说明
