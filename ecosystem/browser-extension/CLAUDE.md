# CLAUDE.md — @lanhu-context/browser-extension

蓝湖设计稿详情页（detailDetach）与项目画布页（stage）的 Chrome MV3 扩展：往两页各自**自绘**的右键菜单注入「复制选中设计稿链接 / 复制 cookies / 发送 cookies 到本机」三项，配合 CLI 的 `lanhu auth listen` 使用。私有包（`private: true`），不发布 npm，但**参与 changesets 发版**（`.changeset/config.json` 的 `privatePackages` 开启 version+tag）：发版打 tag `@lanhu-context/browser-extension@x.y.z`，CI（`.github/workflows/release-extension.yml`，由 release.yml 以 `workflow_call` 调用）把签名 crx + zip 附到该 tag 的 GitHub Release。

## 权威文档

- [docs/NOTES.md](docs/NOTES.md) —— 真机侦察记录（菜单 DOM、`tid` 丢弃行为、stage 页导航树反查等实测事实的唯一来源）
- [docs/implementation-plan.md](docs/implementation-plan.md) / [docs/implementation-plan-stage-menu.md](docs/implementation-plan-stage-menu.md) —— 详情页 / stage 页实施计划存档；蓝湖改版导致注入失效时，按各自 Task 1 折叠区的侦察/验证方法留档重测
- [README.md](README.md) —— 面向用户的安装与使用说明

## 架构（两层 + 适配器，无 MAIN world）

- **content script**（`src/content/`，ISOLATED world，IIFE 产物）：注入菜单 + 解析设计稿参数 + 剪贴板。蓝湖在两页都对原生右键菜单做了 `preventDefault`，所以 `chrome.contextMenus` 不可用，只能 DOM 注入。
- **菜单注入是适配器驱动**：`menu.ts` 只有通用件（`MenuItemSpec` / `MenuAdapter` / `injectInto` / `installMenuInjector`——幂等判据是"我们的行是否还在"，MutationObserver 每批变更做一次合并扫描）；两种宿主菜单方言各自成文件——`menu-detail.ts`（详情页 muse-ui 五层嵌套 + 徽标）与 `menu-stage.ts`（stage 页 `li.operate-item > p` + 分隔线 + 视口定位修正 + 代宿主关菜单）。两个适配器**同时安装**、各按自己的 `dialogSelector` 认领菜单，**没有任何路由判断**——同一份 content script 覆盖两页；stage 页的设计稿 id 由 `stage-target.ts` 从导航树反查。
- **service worker**（`src/background/`，ES module 产物）：用 `chrome.cookies` 取完整 Cookie（含 HttpOnly——这是做成扩展而非油猴脚本的原因）并 POST 到 `http://127.0.0.1:<port>/token`。
- 两层通过 `src/shared/protocol.ts` 的消息类型通信；纯函数放 `src/shared/`。

## 常用命令

```bash
pnpm --filter @lanhu-context/browser-extension build      # 双入口构建 → dist/（SW=ES、content=IIFE，scripts/build.ts 驱动；版本号从 package.json 注入 dist/manifest.json）
pnpm --filter @lanhu-context/browser-extension pack:crx   # dist/ → artifacts/ 下 crx+zip（key 缺省 key.pem，不存在时自动生成；需 Node 22+）
pnpm --filter @lanhu-context/browser-extension typecheck
pnpm vitest run ecosystem/browser-extension               # 测试由根 vitest.config.ts 收录；DOM 测试用 @vitest-environment jsdom
```

构建后在 `chrome://extensions` 开发者模式加载 `dist/`；改代码后需重新 build 并点扩展的刷新按钮。

## 硬性约束

- **`src/content/selectors.ts`（详情页）与 `src/content/stage-selectors.ts`（stage 页）是所有 DOM 代码的唯一依据**，每个选择器都来自真机实测（muse-ui 类名随蓝湖构建变化，不得凭源码推断）。改选择器只改这两个文件，业务逻辑不动。
- **详情页（detailDetach）菜单注入的三条实测铁律**（违反会静默坏掉）：① 列表容器是 `.mu-menu-list` 不是 `.mu-menu`；② 菜单项必须复刻 5 层嵌套（`wrapper > div > ripple + item > title-box > title`），扁平近似会渲染成无样式裸文本；③ 注入项必须 `stopPropagation()` 掉 `mouseup`——宿主收到冒泡的 mouseup 会在 `click` 触发前关闭菜单（仅详情页有此陷阱；stage 页相反，见下条）。
- **严禁自行移除 `#contextMenuWrap`**（stage 菜单容器）：宿主 `menuShow` 仍为 true，下次右键不会重渲染，菜单将永久消失。stage 页宿主靠"目标在菜单外的冒泡 click"关菜单，我们的行点击后菜单不会自己关——必须派发一个 target 在菜单外的 click 让宿主自己关（`closeHostMenu`）。
- **stage 菜单的注入容器是 `ul.operate-list`**：`#contextMenuWrap` 下另有 `ul.menu-children` 二级菜单，勿注入其中；且有两个组件（`ContextMenu` / `ReportMenu`）渲染同一个 id，按 id 认菜单、不绑定组件假设。
- **stage 注入项 `<p>` 的 class 必须 `lanhu-ext-` 前缀**，不得复用宿主 action 名（`p.delete` 会变红、`p.active` 是子菜单展开高亮）；`li` 必须保留 `operate-item` class 才继承样式。
- **stage 页设计稿 id 只能从导航树 `#navTreeRoot .l-tree-node.is-current.is-leafstate[node-id]` 反查**（canvas 无卡片 DOM）。两个闸门缺一不可：菜单里存在 `p.shareImg`（排除空白区右键）、节点带 `is-leafstate`（排除分组——导航树的「⋯」菜单复用同一套 DOM，分组也有这个入口，其 `node-id` 是分组 uuid 不是 image_id）。多选（`.is-current` 多于 1 个）必须返回 null。
- **菜单每次右键都是新建再销毁**，注入靠 MutationObserver 持续观察（`installMenuInjector`），不能只跑一次。
- **设计稿参数取值链**：URL hash 优先 → `localStorage` 兜底；唯 `imageId` 例外——stage 导航树反查传入的外部值优先于 URL，且刻意无存储兜底（陈旧值会静默指向错误设计稿）。兜底存在的原因：详情页 `changeUrlQuery` 切稿时把 `tid` 从 URL 抹掉；stage 页 `changeProject` 切项目时把 query 重建为驼峰 `teamId`，故 URL 侧读 `tid`/`teamId`/`team_id` 三个别名；蓝湖还会往 storage 写字面量 `"undefined"`/`"null"`，必须过滤。见 `src/shared/url.ts` 注释。
- **命名空间**：本扩展的 DOM 标记一律 `data-lanhu-ext-*`。现场可能存在第三方注入器（`data-lanhu-helper-*`），不检测、不移除、不复用其节点。
- **不自带 CSS**：注入项复用宿主已有 class 继承样式；toast 等临时元素用内联样式。
- **端口一致性**：`src/shared/constants.ts` 的 `DEFAULT_BRIDGE_PORT = 7623` 必须与 CLI `lanhu auth listen --port` 默认值一致，改一处必改另一处（`packages/cli/src/commands/auth.ts`）。
- **token 安全**（继承根 CLAUDE.md）：Cookie 等同账号凭据。测试与文档一律用 `sid=FAKE` 类占位符，绝不出现真实 Cookie；日志/toast 不回显 token 内容。
- **crx 签名 key 同凭据级**：key 决定扩展 ID，换 key 等于换扩展。本地 `key.pem` 与一切 `*.pem`/`*.crx` 已被根 .gitignore 拦截，绝不入库；CI 从 repo secret `LANHU_EXT_CRX_KEY` 读取（缺失时 workflow 明确报错，不静默跳过）。manifest 版本号唯一事实源是 package.json（changesets 管理），`public/manifest.json` 里的 version 只是占位，构建时被 `scripts/build.ts` 覆写。
- **manifest 权限最小化**：`cookies` + `clipboardWrite`，`host_permissions` 仅 `*.lanhuapp.com` 与 `127.0.0.1`；新增权限需先在 README「权限说明」给出理由。
