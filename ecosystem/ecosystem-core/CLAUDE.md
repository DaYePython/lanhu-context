# CLAUDE.md — @lanhu-context/ecosystem-core

browser-extension（Chrome MV3 扩展）与 lanhu-monkey（油猴脚本）的**共享层**：蓝湖两页（detailDetach 详情页 / stage 画布页）的右键菜单注入、设计稿参数解析与规范 URL 重建、Cookie 序列化、到本机 `lanhu auth listen` 的桥接封装。私有包，不发布 npm，无构建产物——`exports` 直指 `src/index.ts` 源码，由消费方（两个平台包）的 vite 打进各自产物；参与 changesets 发版（版本变更会按 `updateInternalDependencies` 联动 bump 消费方）。

## 一致性契约（双端保持一致的机制）

- **三项菜单功能（复制选中设计稿链接 / 复制 cookies / 发送 cookies 到本机）的菜单项、文案、toast、行为的唯一实现在本包 `src/app.ts`**（`installLanhuContextMenu`）。平台包只允许实现 `MenuPlatform` 的三个适配器：`copyText` / `readCookieHeader` / `sendCookieHeader`。
- 功能或文案变更 = 改本包，双端 rebuild 即同步。**禁止在 browser-extension 或 lanhu-monkey 里复制业务逻辑**；发现平台包里出现与本包重复的逻辑，视为 bug。
- 平台差异只能通过 `MenuPlatform` 返回值表达（如 `note` 字段承载油猴的降级提示），不得在平台包里各写一套 UI。
- 消费方必须以 `dependencies`（非 devDependencies）声明本包，否则 changesets 不会联动发版。

## 硬性约束（平台无关部分，自扩展迁入）

- **`src/menu/detail-selectors.ts`（详情页）与 `src/menu/stage-selectors.ts`（stage 页）是所有 DOM 代码的唯一依据**，每个选择器都来自真机实测（muse-ui 类名随蓝湖构建变化，不得凭源码推断）。改选择器只改这两个文件，业务逻辑不动；实测记录与重测方法见 `../browser-extension/docs/NOTES.md` 与两份 `implementation-plan*.md`。
- **详情页（detailDetach）菜单注入的三条实测铁律**（违反会静默坏掉）：① 列表容器是 `.mu-menu-list` 不是 `.mu-menu`；② 菜单项必须复刻 5 层嵌套（`wrapper > div > ripple + item > title-box > title`），扁平近似会渲染成无样式裸文本；③ 注入项必须 `stopPropagation()` 掉 `mouseup`——宿主收到冒泡的 mouseup 会在 `click` 触发前关闭菜单（仅详情页有此陷阱；stage 页相反，见下条）。
- **严禁自行移除 `#contextMenuWrap`**（stage 菜单容器）：宿主 `menuShow` 仍为 true，下次右键不会重渲染，菜单将永久消失。stage 页宿主靠"目标在菜单外的冒泡 click"关菜单，我们的行点击后菜单不会自己关——必须派发一个 target 在菜单外的 click 让宿主自己关（`closeHostMenu`）。
- **stage 菜单的注入容器是 `ul.operate-list`**：`#contextMenuWrap` 下另有 `ul.menu-children` 二级菜单，勿注入其中；且有两个组件（`ContextMenu` / `ReportMenu`）渲染同一个 id，按 id 认菜单、不绑定组件假设。
- **stage 注入项 `<p>` 的 class 必须 `lanhu-ext-` 前缀**，不得复用宿主 action 名（`p.delete` 会变红、`p.active` 是子菜单展开高亮）；`li` 必须保留 `operate-item` class 才继承样式。
- **stage 页设计稿 id 只能从导航树 `#navTreeRoot .l-tree-node.is-current.is-leafstate[node-id]` 反查**（canvas 无卡片 DOM）。两个闸门缺一不可：菜单里存在 `p.shareImg`（排除空白区右键）、节点带 `is-leafstate`（排除分组）。多选（`.is-current` 多于 1 个）必须返回 null。
- **菜单每次右键都是新建再销毁**，注入靠 MutationObserver 持续观察（`installMenuInjector`），不能只跑一次；幂等判据是"我们的行是否还在"，不是 dialog 上的标志位。
- **设计稿参数取值链**：URL hash 优先 → `localStorage` 兜底；唯 `imageId` 例外——stage 导航树反查传入的外部值优先于 URL，且刻意无存储兜底（陈旧值会静默指向错误设计稿）。URL 侧 `tid`/`teamId`/`team_id` 三个别名都要读；蓝湖会往 storage 写字面量 `"undefined"`/`"null"`/空串，必须过滤。见 `src/url.ts` 注释。
- **命名空间**：注入的 DOM 标记一律 `data-lanhu-ext-*`。现场可能存在第三方注入器（`data-lanhu-helper-*`），不检测、不移除、不复用其节点。
- **不自带 CSS**：注入项复用宿主已有 class 继承样式；toast 等临时元素用内联样式。
- **本包禁止出现 `chrome.*` 与 `GM_*`**：平台 API 一律通过 `MenuPlatform` / `CookieApi` / `BridgeFetch` 注入。测试用 fake 注入，不 mock 全局。
- **端口一致性**：`src/constants.ts` 的 `DEFAULT_BRIDGE_PORT = 7623` 必须与 CLI `lanhu auth listen --port` 默认值一致，改一处必改另一处（`packages/cli/src/commands/auth.ts`）。
- **token 安全**（继承根 CLAUDE.md）：Cookie 等同账号凭据。测试与文档一律用 `sid=FAKE` 类占位符；日志/toast 不回显 token 内容。

## 常用命令

```bash
pnpm --filter @lanhu-context/ecosystem-core typecheck
pnpm vitest run ecosystem/ecosystem-core        # 测试由根 vitest.config.ts 收录；DOM 测试用 @vitest-environment jsdom
```
