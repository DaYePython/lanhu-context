# stage 页右键菜单支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐个实施。步骤使用 `- [ ]` 复选框语法便于跟踪。

**Goal:** 把「复制选中设计稿链接 / 复制 cookies / 发送 cookies 到本机」三个菜单项扩展到蓝湖画布页 `#/item/project/stage` 的右键菜单，与详情页 `detailDetach` 行为一致。

**Architecture:** 把现有单一 DOM 方言的注入器改造成**适配器驱动**：`menu.ts` 只留通用注入器，detail 与 stage 两种菜单结构各自成文件，两个适配器同时安装、各按自己的选择器认领菜单——**无需任何路由判断**，同一份 content script 覆盖两页。stage 页的设计图由 fabric.js 画在 canvas 上、DOM 无卡片节点，因此右键目标的 image_id 改从**左侧画板导航树**（`#navTreeRoot .l-tree-node.is-current[node-id]`）反查，仍在 ISOLATED world 内完成，不引入 `world: "MAIN"`。

**Tech Stack:** 无新增依赖。Chrome MV3、TypeScript 5、Vite 7、vitest + jsdom、pnpm workspace。

---

## Global Constraints

以下约束来自 `CLAUDE.md`、`ecosystem/browser-extension/CLAUDE.md` 与本轮侦察，**每个任务的验收标准都隐含包含本节**：

- **不引入 `world: "MAIN"`**：全部逻辑留在 ISOLATED world。若某功能只能靠读页面 JS 对象实现，宁可不做该功能，并在 `docs/NOTES.md` 记录原因。
- **不改 `manifest.json` 的 `matches`**：现值 `https://lanhuapp.com/web/*` 不含 hash，content script **本来就已经运行在 stage 页**。只允许改 `description` 文案。
- **不自带 CSS 文件**：注入项复用宿主 class 继承样式；仅允许在**我们自己创建的节点**上写内联样式。
- **不移除、不改写宿主节点**：尤其**严禁自行删除 `#contextMenuWrap`**——宿主的 `menuShow` 仍为 `true`，下次右键不会触发重渲染，菜单将永久消失。关闭菜单必须走宿主自己的关闭路径。
- **命名空间**：DOM 标记一律 `data-lanhu-ext-*`；注入项 `<p>` 的 class 一律 `lanhu-ext-` 前缀，**不得复用宿主 action 名**（`p.delete` 会变红、`p.active` 是子菜单展开高亮）。
- **token 安全**：Cookie 等同账号凭据。测试与文档一律用 `sid=FAKE` 占位符，绝不出现真实 Cookie，不在 toast/日志回显 token 内容。
- **端口一致性**：`DEFAULT_BRIDGE_PORT = 7623` 必须与 CLI `lanhu auth listen --port` 默认值一致。本轮不动。
- **代码风格**：biome（`pnpm lint`）。英文技术注释 + 中文用户可见文案，沿用既有文件风格。
- **无需 changeset**：`@lanhu-context/browser-extension` 是 private 包不发版；本轮**不改动 `packages/`**，CLI 无变更。
- **测试环境**：DOM 测试首行必须写 `// @vitest-environment jsdom`。测试由根 `vitest.config.ts` 收录，跑 `pnpm vitest run ecosystem/browser-extension`。

---

## 逆向结论摘要（本轮已完成，实施时以此为准）

### A. stage 页菜单的结构与生命周期

菜单由 Vue 组件 `ContextMenu` 以 **`v-if` 渲染**：每次右键新建、关闭即销毁——与详情页同款，所以 `MutationObserver` 持续重注入的思路成立。

实测 DOM（用户真机抓取，已脱去 svg 细节）：

```html
<div id="contextMenuWrap" style="left: 832px; top: 639px; bottom: unset;">
  <ul class="operate-list">
    <li class="operate-item"><p class="rename"> 重命名</p><hr></li>
    <li class="operate-item"><p class="moveToGroup"> 移动至分组<span class="corner"></span></p></li>
    <li class="operate-item"><p class="copy"> 复制</p><svg …/></li>
    <li class="operate-item"><p class="shareImg"> 分享设计图</p></li>
    <li class="operate-item"><p class="downloadImg"> 下载设计图</p></li>
    <li class="operate-item"><p class="delete"> 删除</p><svg …/></li>
  </ul>
  <ul class="menu-children">…</ul>   <!-- 二级菜单，勿注入到这里 -->
</div>
```

**五条会咬人的事实：**

1. **`#contextMenuWrap` 下有两个 `ul`。** 列表容器是 **`ul.operate-list`**，另一个 `ul.menu-children` 是二级菜单。选择器写松会把菜单项塞进子菜单。
2. **同名陷阱**：另有组件 `ReportMenu` 渲染**完全相同**的 `#contextMenuWrap` 结构（与 `ContextMenu` 互斥显示），且两者在模板里**用了同一个 `ref="stageContextMenu"`**（宿主自身的 bug）。注入器一律按 `#contextMenuWrap` 这个 id 认，不得绑定组件假设。
3. **菜单内容随右键目标变化**：右键空白/分组只有「刷新 / 粘贴」两项；右键设计图才是上面那套；右键连线 3 项。**极端情况列表为空时整个 `#contextMenuWrap` 都不会出现**——注入器必须容忍菜单不存在。
4. **不存在详情页那个 mouseup 陷阱，反而相反。** 宿主只在 `document` 上挂了一个冒泡 `click` 监听，判据是"目标不在菜单内则关闭"。我们的 `li` 在菜单内 ⇒ 不需要 `stopPropagation` 保命，但**点完之后菜单不会自己关**，必须由我们派发一个 target 在菜单外的 click 让宿主自己关。
5. **菜单不由 DOM `contextmenu` 事件驱动**：它由 fabric canvas 的 mousedown（`which===3`）触发；页面还用 `document.oncontextmenu = e => e.preventDefault()` 全局屏蔽了原生右键菜单。**所以既不能用 `chrome.contextMenus`，也不能靠监听 `contextmenu` 预判菜单出现——只能靠 MutationObserver。**

**额外实测（2026-08-16）：左侧导航树节点上的「⋯ 更多」按钮打开的是同一个 `#contextMenuWrap`**——容器 id、`ul.operate-list`、`li.operate-item > p` 结构、12 项内容全部一致（`isContextMenuWrap: true`）。**因此不需要为它单独写适配器，stage 适配器按 id 认菜单时会自动覆盖这条入口。** 唯一的新增风险是分组节点也有「⋯」，其 `.is-current` 行的 `node-id` 是分组 uuid——由 `is-leafstate` 判据挡住（见 §C）。

### B. stage 页菜单的样式规则（决定注入项怎么写）

全部来自 `editor~stage-block` 的 CSS：

```css
#contextMenuWrap{width:184px!important;position:fixed;z-index:999;…}
#contextMenuWrap .operate-list .operate-item{position:relative;cursor:pointer}
#contextMenuWrap .operate-list .operate-item p{font-size:14px;line-height:32px;padding:0 12px;margin-bottom:2px}
#contextMenuWrap .operate-item p{margin:0;height:32px;line-height:32px;color:#2f2e3f}
#contextMenuWrap .operate-list .operate-item p:hover{background:#edf0f3!important}
#contextMenuWrap .operate-list .operate-item hr{border:0;height:1px;background-color:#eeeff1;margin:10px 0!important}
#contextMenuWrap .operate-list .operate-item:last-child hr{display:none}
```

**四条推论：**

1. **基础样式与 hover 只要求 `li.operate-item > p` 结构，不要求 action class。** 保持该结构即可继承全部样式；`.operate-item` 这个 class 必须保留。
2. **追加节点会让宿主原最后一项被隐藏的 `<hr>` 重新显形**（`:last-child` 不再成立）。这恰好可以当作我们这组菜单项的分隔线；但宿主最后一项**未必**带 `<hr>`（`delete` 就没有），所以要在它没有时自己补一条，保证视觉一致。
3. **宽度锁死 184px，顶层 `p` 没有 `white-space:nowrap`**，而 `p` 是固定 `height:32px;line-height:32px`——文案换行会溢出叠到下一行。注入项须自加 `nowrap + ellipsis` 内联样式兜底。
4. **容器无 `max-height`、不滚动。** 但宿主用 `32 * menuItem.length + 16 + 21 * divideCount` 估算菜单高度来决定向上还是向下展开，**我们追加的行不在它的账里**（约 +102px），在视口底部附近右键会被裁掉看不见（`position:fixed` 无滚动）。需要注入后自行修正定位。

### C. stage 页的设计稿 id：canvas 不可达，导航树可达

设计图由 fabric.js 画在 `<canvas id="stage">` 上，`#canvas-wrap` 只有 `.temp-group` 和 `<canvas>` 两个子节点，**不存在每张图对应的 DOM**；`#contextMenuWrap` 上也没有任何 `data-*` 携带当前目标；右键链路全程不写 URL。右键目标只活在 JS 对象 `target.lanhu_imageId` 里。

**唯一的 DOM 侧信道是左侧画板导航树：**

```
#navTreeRoot  .l-tree-node[node-id]          node-id = 设计图 image_id
              .l-tree-node[node-layer]       node-layer = 树内 uuid，⚠ 不是 image_id
              .l-tree-node.is-current        画布选中态镜像
```

画布选中会驱动 `activeIds` 更新，进而给对应树节点加 `.is-current`，且宿主会自动展开其祖先分组。

**真机实测已确认（Task 1，2026-08-16）**：右键一张设计图时 `.is-current[node-id]` 恰好 **1** 个，其 `node-id` 与该设计稿详情页 URL 的 `image_id` **完全相等**（形如 `dacd1d67-8920-4b66-841b-83da92efc90d`）；菜单 DOM 出现时 `.is-current` 已就绪；折叠分组内右键，宿主会自动展开祖先，`currentCount === 1` 仍成立。**选中节点还带 `is-leafstate` 类**，可作叶子判据。

**两条误取风险及其判据**：

1. **右键空白画布区** —— 实测 `hasShareImg: false`。宿主按目标类型过滤菜单项，只有右键**设计图**时菜单里才有「分享设计图」`p.shareImg`；以它作为"当前目标是设计图"的闸门，可靠且纯 DOM。
2. **多选** —— 实测 `.is-current` 有多个（均为 `is-leafstate`），此时"哪一张"无从判断，必须返回 null。

**已排除的风险**：分组**没有右键菜单**（实测：分组是左键选中，不弹菜单），所以画布右键路径上不存在"取到分组 uuid"的可能。但导航树的「⋯」菜单路径上分组仍可能出现，那里需要 `is-leafstate` 判据。

### D. 规范链接形态（用于校验我们拼的 URL）

- 承载设计稿 id 的参数名是 **`image_id`**。`docId` 属于另一条路由 `#/item/project/product`（原型文档页），与设计稿详情无关。
- 宿主自己从 stage 跳详情页时**继承 stage 页全部 query 并追加 `project_id` + `image_id`**；通知深链的完整形态是 `detailDetach?project_id=&tid=&pid=&image_id=&comment_id=&version_id=`。
- 参数必要性：`image_id` / `pid` **必需**；`project_id` **建议保留**（它是详情页 `project.id` 的唯一初始来源，只给 `pid` 时开局为 `undefined`）；`tid` **建议保留**（跨团队用户缺它可能落到错误团队上下文）；`comment_id` / `version_id` / `fromEditor` / `type` **可丢**。
- **`version_id` 确定不需要**：蓝湖查看历史版本时根本不写 URL（三个版本组件内 `$route` / `pushState` 出现次数为 0），任何 detailDetach 链接打开都是最新版。URL 里的 `version_id` 只服务于评论定位，须与 `comment_id` 成对出现。
- **「分享设计图」不是同一形态**：它生成的是 **stage 页短链**（`?focusItem=<id>`，POST `/api/sharesvc/link` 换取，14 天有效期），语义是"在画布上定位到这张图"，与"打开标注详情"是两回事。**不要把 `focusItem` 引进我们的规范链接**，detailDetach 路由不消费它。

### E. stage 页 URL 与 tid 丢失（比详情页更复杂）

规范形态是 `#/item/project/stage?tid=<team>&pid=<project>`，但切换项目时宿主的 `changeProject` 会把 query 重建为 `{type, pid, teamId}`——**`tid` 被丢弃并换成了驼峰 `teamId`**。宿主自己的 `getTeamId()` 读取链是 `query.team_id || query.tid || this.team_id || localStorage.team_id`。

**对我们的影响**：现有 `resolveDesignRef` 只读 `tid` / `team_id` 两个别名，**漏了 `teamId`**，在切过项目的 stage 页会白白掉进 localStorage 兜底。Task 5 修正。`localStorage` 的 `pid` / `team_id` 兜底在 stage 页同样有效，占位串陷阱（`"null"` / `"undefined"`）也同样存在——现有 `PLACEHOLDERS` 过滤继续适用。

---

## File Structure

| 文件 | 状态 | 职责 |
| --- | --- | --- |
| `src/content/selectors.ts` | 不变 | 详情页菜单选择器常量 |
| `src/content/stage-selectors.ts` | **新建**（Task 1） | stage 页菜单与导航树的实测常量 |
| `src/content/menu.ts` | 改造（Task 2） | 只留通用件：`MenuItemSpec` / `MenuAdapter` / `ITEM_ATTR` / `injectInto` / `installMenuInjector` |
| `src/content/menu-detail.ts` | **新建**（Task 2） | 详情页方言：`buildDetailRow` / `detailMenuAdapter`（从 menu.ts 迁出） |
| `src/content/menu-stage.ts` | **新建**（Task 3） | stage 页方言：`buildStageRow` / `insertStageRows` / `closeHostMenu` / `stageMenuAdapter` |
| `src/content/stage-target.ts` | **新建**（Task 4） | `readStageImageId`：从导航树反查右键目标 image_id |
| `src/content/position.ts` | **新建**（Task 7） | `correctedTop`：修正宿主漏算我们行高导致的越界 |
| `src/content/messaging.ts` | **新建**（Task 6） | `ask`：service worker 消息通道 + 失效容错 |
| `src/shared/url.ts` | 修改（Task 5） | 增加 `teamId` 别名、外部 imageId、`project_id`、`resolveDesignRefParts` |
| `src/content/index.ts` | 修改（Task 8） | 接线两个适配器 + 导航树反查 + 精确报错文案 |
| `src/content/clipboard.ts` | 不变 | — |
| `public/manifest.json` | 改文案（Task 9） | 仅 `description` |
| `docs/NOTES.md` | 追加（Task 1 / 9） | stage 页侦察记录 |
| `README.md` / `CLAUDE.md` | 修改（Task 9） | 两页说明与新增硬性约束 |

---

### Task 1: 固化 stage 实测常量 ✅ 真机验证已完成

**真机验证已在计划阶段完成，结论全部通过 —— Plan B 不触发，三个菜单项在 stage 页全部可做。** 本任务只剩把实测常量与侦察记录落盘。

**实测数据（2026-08-16，真机）：**

| 场景 | `hasShareImg` | `.is-current[node-id]` 数量 | 结论 |
| --- | --- | --- | --- |
| 右键一张设计图 | `true` | **1** | ✅ 可取，`node-id` = `image_id` |
| 右键空白画布区 | `false` | — | 被 `p.shareImg` 闸门拦截，返回 null |
| 右键分组 | —— | —— | **分组没有右键菜单**（左键选中），该路径不存在 |
| 框选多张后右键 | `true` | **>1** | 被数量判据拦截，返回 null |

- **核心断言成立**：`ids[0]` = `dacd1d67-8920-4b66-841b-83da92efc90d`，与双击进入该设计稿后地址栏的 `image_id` **完全相等**（uuid 形态）。
- 右键设计图时菜单为完整 12 项：`rename / moveToGroup / addToGroup / notifyMembers / copy / paste / shareImg / downloadImg / downloadSlice / downloadCombineImg / setCover / delete`；`listCount: 1`，即 `#contextMenuWrap` 下只有一个 `ul.operate-list`。
- 选中节点完整 class 为 `l-tree-node project-nav-tree-node is-current is-leafstate is-focusable is-showoperaticon`，`hasChildNodes: false`。**`is-leafstate` 可作叶子判据**——导航树「⋯」菜单路径需要它区分分组与设计图。
- **时序无问题**：`#contextMenuWrap` 存在时 `.is-current` 已为 1。
- **折叠分组**：宿主自动展开祖先，`currentCount === 1` 仍成立。
- `#navTreeRoot` 存在，含 5 个 `[node-id]` 节点。

**Files:**
- Create: `ecosystem/browser-extension/src/content/stage-selectors.ts`
- Modify: `ecosystem/browser-extension/docs/NOTES.md`

**Interfaces:**
- Consumes: 无
- Produces: `STAGE_DIALOG_SELECTOR` / `STAGE_LIST_SELECTOR` / `STAGE_ITEM_CLASS` / `STAGE_LABEL_PREFIX` / `STAGE_DESIGN_MENU_MARKER` / `STAGE_TREE_CURRENT_SELECTOR` / `STAGE_TREE_ID_ATTR`

- [ ] **Step 1: 写入实测常量**

`ecosystem/browser-extension/src/content/stage-selectors.ts`：

```ts
// Measured on the live stage page (2026-08-16). See docs/NOTES.md for the
// captured output. Stage draws its design cards with fabric.js, so unlike
// detailDetach there is no per-card DOM — the left nav tree is the only DOM
// mirror of the canvas selection, and these selectors are the whole basis for
// reading it.

/** Popover root. Two different components render this same id; match the id. */
export const STAGE_DIALOG_SELECTOR = '#contextMenuWrap';

/**
 * Item container. Note `#contextMenuWrap` also holds `ul.menu-children` for
 * submenus — appending there would nest our rows inside a flyout.
 */
export const STAGE_LIST_SELECTOR = 'ul.operate-list';

/** Host CSS keys off this class for padding, hover and cursor. */
export const STAGE_ITEM_CLASS = 'operate-item';

/**
 * Prefix for our label class. Never reuse a host action name: `p.delete`
 * renders red and `p.active` is the submenu-open highlight.
 */
export const STAGE_LABEL_PREFIX = 'lanhu-ext-';

/**
 * Only a design right-click gets 分享设计图 in the menu — measured false on a
 * blank-area right-click. Its presence is our "the target is a design" gate.
 */
export const STAGE_DESIGN_MENU_MARKER = 'ul.operate-list p.shareImg';

/** Selected rows in the nav tree; `node-id` carries the design's image_id. */
export const STAGE_TREE_CURRENT_SELECTOR =
  '#navTreeRoot .l-tree-node.is-current.is-leafstate[node-id]';

/** ⚠ Not `node-layer` — that one is a tree-internal uuid, not an image id. */
export const STAGE_TREE_ID_ATTR = 'node-id';
```

> **`is-leafstate` 不是可选的**：分组行同样会拿到 `.is-current`，但它的 `node-id` 是客户端生成的分组 uuid。导航树节点的「⋯」菜单复用同一套 DOM，分组也有这个入口，所以必须靠叶子判据把分组挡在外面。

- [ ] **Step 2: 把侦察记录写进 NOTES.md**

在 `ecosystem/browser-extension/docs/NOTES.md` 末尾追加一节 `## 6. stage 页（#/item/project/stage）侦察结论`，把本任务开头那张实测表格、核心断言（`node-id` = `image_id` 及其 uuid 样例）、12 项菜单清单、节点 class、时序与折叠分组结论全部写入，并写明根本事实：**canvas 无卡片 DOM，导航树是唯一 DOM 侧信道**。

- [ ] **Step 3: Commit**

```bash
git add ecosystem/browser-extension/src/content/stage-selectors.ts ecosystem/browser-extension/docs/NOTES.md
git commit -m "docs(extension): record stage page recon and pin its selectors"
```

<details>
<summary>验证方法留档（仅在蓝湖改版导致反查失效时需要重跑）</summary>

打开 `https://lanhuapp.com/web/#/item/project/stage?tid=<team>&pid=<project>`，确认已登录、设计图已渲染、左侧导航树展开。先确认导航树存在：

```js
console.log('navTreeRoot:', !!document.querySelector('#navTreeRoot'));
console.log('nodes:', document.querySelectorAll('#navTreeRoot .l-tree-node[node-id]').length);
```

右键一张设计图，**保持菜单打开**（在 Console 里操作不会关闭它），执行：

```js
const wrap = document.querySelector('#contextMenuWrap');
const rows = [...document.querySelectorAll('#navTreeRoot .l-tree-node.is-current[node-id]')];
console.log(JSON.stringify({
  menuOpen: !!wrap,
  listCount: wrap ? wrap.querySelectorAll('ul.operate-list').length : 0,
  items: wrap ? [...wrap.querySelectorAll('ul.operate-list > li.operate-item > p')]
    .map(p => p.className + '|' + p.textContent.trim()) : [],
  hasShareImg: !!wrap?.querySelector('ul.operate-list p.shareImg'),
  currentCount: rows.length,
  ids: rows.map(r => r.getAttribute('node-id')),
  nodeClasses: rows.map(r => r.className),
  hasChildNodes: rows.map(r => !!r.querySelector('.l-tree-node'))
}, null, 2));
```

**关键断言**：`currentCount === 1`、`hasShareImg === true`、`ids[0]` 等于双击进入该设计稿后地址栏的 `image_id`。再分别对空白画布区、多选、折叠分组内的设计图重跑取反例。

**若核心断言不再成立**，改走 Plan B：stage 页只注入两个 cookie 菜单项（它们不需要任何设计稿上下文），「复制选中设计稿链接」退回详情页独有。做法是跳过 Task 4，并在 Task 8 接线时给 stage 适配器传入过滤掉 `copy-design-url` 的 specs。

</details>

---

### Task 2: 注入器改造为适配器驱动

纯重构 + 一处行为增强。现有 18 个测试是安全网：**本任务不得增删断言**，只调整 import 与调用签名；最后一步才追加 1 个新测试。

**Files:**
- Modify: `ecosystem/browser-extension/src/content/menu.ts`
- Create: `ecosystem/browser-extension/src/content/menu-detail.ts`
- Modify: `ecosystem/browser-extension/src/content/__tests__/menu.spec.ts`

**Interfaces:**
- Consumes: `selectors.ts` 全部导出
- Produces:
  - `interface MenuItemSpec { id: string; label: string; onSelect: () => void; badge?: string }`
  - `interface MenuAdapter { readonly dialogSelector: string; readonly listSelector: string; insert(list: Element, specs: MenuItemSpec[]): void }`
  - `const ITEM_ATTR = 'data-lanhu-ext-item'`
  - `injectInto(dialog: HTMLElement, specs: MenuItemSpec[], adapter: MenuAdapter): boolean`
  - `installMenuInjector(root: Element, specs: MenuItemSpec[], adapters: MenuAdapter[]): () => void`
  - `buildDetailRow(spec: MenuItemSpec): HTMLElement`、`detailMenuAdapter: MenuAdapter`

- [ ] **Step 1: 建 menu-detail.ts，迁入详情页方言**

`ecosystem/browser-extension/src/content/menu-detail.ts`（`buildDetailRow` 的函数体与原 `buildMenuItem` **逐字相同**，只改函数名并补上适配器）：

```ts
import { type MenuAdapter, type MenuItemSpec } from './menu';
import {
  BADGE_BOX_CLASS,
  BADGE_CLASS,
  DIALOG_SELECTOR,
  ITEM_CLASS,
  LIST_SELECTOR,
  RIPPLE_CLASS,
  TITLE_BOX_CLASS,
  TITLE_CLASS,
  WRAPPER_CLASS,
  WRAPPER_STYLE
} from './selectors';

const ITEM_FLAG = 'lanhuExtItem';

/**
 * Rebuilds the host's row markup node for node (see docs/NOTES.md). muse-ui
 * styles key off this exact nesting, so a flatter approximation renders
 * unstyled:
 *
 *   div[data-lanhu-ext-item]
 *     div.mu-menu-item-wrapper
 *       div
 *         div.mu-ripple-wrapper
 *         div.mu-menu-item
 *           div.mu-menu-item-title > span.menu-item-title
 *           div > span.key-icon > span.hotkey
 */
export function buildDetailRow(spec: MenuItemSpec): HTMLElement {
  const row = document.createElement('div');
  row.dataset[ITEM_FLAG] = spec.id;

  const wrapper = document.createElement('div');
  wrapper.className = WRAPPER_CLASS;
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'menuitem');
  wrapper.setAttribute('style', WRAPPER_STYLE);

  const inner = document.createElement('div');

  const ripple = document.createElement('div');
  ripple.className = RIPPLE_CLASS;

  const item = document.createElement('div');
  item.className = ITEM_CLASS;

  const titleBox = document.createElement('div');
  titleBox.className = TITLE_BOX_CLASS;
  const title = document.createElement('span');
  title.className = TITLE_CLASS;
  title.textContent = spec.label;
  titleBox.append(title);

  const afterBox = document.createElement('div');
  if (spec.badge) {
    const keyIcon = document.createElement('span');
    keyIcon.className = BADGE_BOX_CLASS;
    const hotkey = document.createElement('span');
    hotkey.className = BADGE_CLASS;
    hotkey.textContent = spec.badge;
    keyIcon.append(hotkey);
    afterBox.append(keyIcon);
  }

  item.append(titleBox, afterBox);
  inner.append(ripple, item);
  wrapper.append(inner);
  row.append(wrapper);

  // Listeners sit on the row so clicks anywhere inside the nesting count.
  // The host closes its menu on a bubbling mouseup, which would tear the
  // popover down before click ever fires.
  row.addEventListener('mouseup', event => event.stopPropagation());
  row.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  row.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    spec.onSelect();
  });

  return row;
}

export const detailMenuAdapter: MenuAdapter = {
  dialogSelector: DIALOG_SELECTOR,
  listSelector: LIST_SELECTOR,
  insert(list, specs) {
    for (const spec of specs) list.append(buildDetailRow(spec));
  }
};
```

- [ ] **Step 2: 把 menu.ts 收敛成通用注入器**

`ecosystem/browser-extension/src/content/menu.ts`（**整文件替换**）：

```ts
export interface MenuItemSpec {
  id: string;
  label: string;
  onSelect: () => void;
  /** Optional right-aligned chip. Adapters may ignore it. */
  badge?: string;
}

/**
 * One host menu dialect. Lanhu renders a different context menu per page —
 * muse-ui on detailDetach, a plain `ul.operate-list` on stage — so the
 * injector knows only how to find a menu and delegate the markup.
 */
export interface MenuAdapter {
  /** Right-click menu root this adapter claims. */
  readonly dialogSelector: string;
  /** Item container inside that root. */
  readonly listSelector: string;
  /** Appends our rows, in this host's dialect. Owns any host-specific fixups. */
  insert(list: Element, specs: MenuItemSpec[]): void;
}

export const ITEM_ATTR = 'data-lanhu-ext-item';

export function injectInto(
  dialog: HTMLElement,
  specs: MenuItemSpec[],
  adapter: MenuAdapter
): boolean {
  const list = dialog.querySelector(adapter.listSelector);
  if (!list) return false;
  // Idempotence keys off our rows still being present, not a flag on the
  // dialog: a flag goes stale the moment the host re-renders its list and
  // drops them, and we would never put them back.
  if (list.querySelector(`[${ITEM_ATTR}]`)) return false;

  adapter.insert(list, specs);
  return true;
}

/**
 * Both menus are mounted and unmounted on every right-click, so the injector
 * has to observe rather than run once. Each batch triggers one coalesced
 * sweep: cheap, and it also recovers when a host re-render drops our rows.
 */
export function installMenuInjector(
  root: Element,
  specs: MenuItemSpec[],
  adapters: MenuAdapter[]
): () => void {
  let disposed = false;
  let scheduled = false;

  const sweep = (): void => {
    for (const adapter of adapters) {
      for (const dialog of root.querySelectorAll<HTMLElement>(
        adapter.dialogSelector
      )) {
        injectInto(dialog, specs, adapter);
      }
    }
  };

  const schedule = (): void => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!disposed) sweep();
    });
  };

  sweep();

  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });

  return () => {
    disposed = true;
    observer.disconnect();
  };
}
```

- [ ] **Step 3: 机械调整既有测试（不动断言）**

`ecosystem/browser-extension/src/content/__tests__/menu.spec.ts` 四处改动：

1. 第 3 行的 import 拆成两行：

```ts
import { injectInto, installMenuInjector } from '../menu';
import { buildDetailRow, detailMenuAdapter } from '../menu-detail';
```

2. 全文件把 `buildMenuItem(` 替换为 `buildDetailRow(`（9 处），并把 `describe('buildMenuItem', …)` 改为 `describe('buildDetailRow', …)`。
3. 全文件把 `injectInto(dialog, specs)` 替换为 `injectInto(dialog, specs, detailMenuAdapter)`（6 处）。
4. 全文件把 `installMenuInjector(document.body, specs)` 替换为 `installMenuInjector(document.body, specs, [detailMenuAdapter])`（4 处）。

- [ ] **Step 4: 跑测试确认重构无回归**

Run: `pnpm vitest run ecosystem/browser-extension/src/content/__tests__/menu.spec.ts`
Expected: 18 tests PASS（数量与断言均不变）

- [ ] **Step 5: 补一个新测试，锁住"行被清掉能自愈"**

在 `menu.spec.ts` 的 `describe('installMenuInjector', …)` 内追加：

```ts
  it('re-injects when the host re-renders the list and drops our rows', async () => {
    const dispose = installMenuInjector(document.body, specs, [
      detailMenuAdapter
    ]);
    const dialog = makeDialog();
    document.body.append(dialog);
    await vi.waitFor(() =>
      expect(itemCount(dialog)).toBe(HOST_ITEMS + specs.length)
    );

    // A stale dataset flag on the dialog would make this unrecoverable.
    for (const row of dialog.querySelectorAll('[data-lanhu-ext-item]')) {
      row.remove();
    }
    dialog.querySelector('.mu-menu-list')!.append(document.createElement('div'));

    await vi.waitFor(() =>
      expect(itemCount(dialog)).toBe(HOST_ITEMS + specs.length)
    );
    dispose();
  });
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm vitest run ecosystem/browser-extension/src/content/__tests__/menu.spec.ts`
Expected: 19 tests PASS

- [ ] **Step 7: Commit**

```bash
git add ecosystem/browser-extension/src/content/menu.ts ecosystem/browser-extension/src/content/menu-detail.ts ecosystem/browser-extension/src/content/__tests__/menu.spec.ts
git commit -m "refactor(extension): make the menu injector adapter-driven"
```

---

### Task 3: stage 页菜单适配器

**Files:**
- Create: `ecosystem/browser-extension/src/content/menu-stage.ts`
- Test: `ecosystem/browser-extension/src/content/__tests__/menu-stage.spec.ts`

**Interfaces:**
- Consumes: `MenuAdapter` / `MenuItemSpec` / `ITEM_ATTR`（Task 2）、`stage-selectors.ts` 全部导出（Task 1）
- Produces: `buildStageRow(spec: MenuItemSpec): HTMLElement`、`insertStageRows(list: Element, specs: MenuItemSpec[]): void`、`closeHostMenu(): void`、`stageMenuAdapter: MenuAdapter`

- [ ] **Step 1: 写失败测试**

`ecosystem/browser-extension/src/content/__tests__/menu-stage.spec.ts`：

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { injectInto } from '../menu';
import { buildStageRow, stageMenuAdapter } from '../menu-stage';
import { STAGE_ITEM_CLASS, STAGE_LABEL_PREFIX } from '../stage-selectors';

const specs = [
  { id: 'copy-design-url', label: '复制选中设计稿链接', onSelect: vi.fn() },
  { id: 'copy-cookies', label: '复制 cookies', onSelect: vi.fn() },
  { id: 'send-cookies', label: '发送 cookies 到本机', onSelect: vi.fn() }
];

/**
 * Verbatim host markup captured in docs/NOTES.md, trimmed of the hotkey svgs.
 * `delete` is the real last row and carries no <hr>; `menu-children` is the
 * submenu container that must never receive our rows.
 */
function makeMenu(lastRowHasDivider = false): HTMLElement {
  const wrap = document.createElement('div');
  wrap.id = 'contextMenuWrap';
  wrap.innerHTML = `
    <ul class="operate-list">
      <li class="operate-item"><p class="rename"> 重命名</p><hr></li>
      <li class="operate-item"><p class="shareImg"> 分享设计图</p></li>
      <li class="operate-item"><p class="delete"> 删除</p>${
        lastRowHasDivider ? '<hr>' : ''
      }</li>
    </ul>
    <ul class="menu-children"><li class="menu-child"><p>新建分组</p></li></ul>`;
  return wrap;
}

const HOST_ROWS = 3;

function ourRows(root: ParentNode): Element[] {
  return [...root.querySelectorAll('[data-lanhu-ext-item]')];
}

beforeEach(() => {
  document.body.innerHTML = '';
  for (const spec of specs) spec.onSelect.mockClear();
});

describe('buildStageRow', () => {
  it('reproduces the host row shape: li.operate-item > p', () => {
    const row = buildStageRow(specs[0]!);
    expect(row.tagName).toBe('LI');
    // Host CSS keys off this class for padding, hover and cursor.
    expect(row.classList.contains(STAGE_ITEM_CLASS)).toBe(true);
    expect(row.firstElementChild?.tagName).toBe('P');
  });

  it('renders the label text into the p', () => {
    const row = buildStageRow(specs[0]!);
    expect(row.querySelector('p')?.textContent).toBe('复制选中设计稿链接');
  });

  it('namespaces the label class away from host action names', () => {
    const row = buildStageRow(specs[0]!);
    const className = row.querySelector('p')!.className;
    expect(className).toBe(`${STAGE_LABEL_PREFIX}copy-design-url`);
    // p.delete renders red, p.active is the submenu highlight.
    expect(className).not.toBe('delete');
    expect(className).not.toBe('active');
  });

  it('marks the row with the extension namespace', () => {
    const row = buildStageRow(specs[0]!);
    expect(row.getAttribute('data-lanhu-ext-item')).toBe('copy-design-url');
  });

  it('pins the label to one line: the menu is a hard 184px', () => {
    const row = buildStageRow(specs[0]!);
    const label = row.querySelector('p') as HTMLElement;
    expect(label.style.whiteSpace).toBe('nowrap');
    expect(label.style.textOverflow).toBe('ellipsis');
  });

  it('ignores badge — the host row has no text badge slot', () => {
    const row = buildStageRow({ ...specs[0]!, badge: 'CLI' });
    expect(row.textContent).toBe('复制选中设计稿链接');
  });

  it('invokes onSelect on click', () => {
    const row = buildStageRow(specs[0]!);
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(specs[0]!.onSelect).toHaveBeenCalledOnce();
  });

  it('invokes onSelect when the click lands on the inner label', () => {
    const row = buildStageRow(specs[0]!);
    document.body.append(row);
    row.querySelector('p')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
    expect(specs[0]!.onSelect).toHaveBeenCalledOnce();
  });

  it('closes the host menu after running the action', () => {
    const wrap = makeMenu();
    document.body.append(wrap);
    const row = buildStageRow(specs[0]!);
    wrap.querySelector('ul.operate-list')!.append(row);

    const seen: EventTarget[] = [];
    document.addEventListener('click', event => {
      if (event.target) seen.push(event.target);
    });
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // The host closes on a document click whose target is outside the popover.
    expect(seen.some(target => !wrap.contains(target as Node))).toBe(true);
  });
});

describe('stageMenuAdapter', () => {
  it('appends every spec into ul.operate-list', () => {
    const wrap = makeMenu();
    expect(injectInto(wrap, specs, stageMenuAdapter)).toBe(true);
    expect(
      wrap.querySelectorAll('ul.operate-list > li.operate-item')
    ).toHaveLength(HOST_ROWS + specs.length);
  });

  it('never touches the submenu list', () => {
    const wrap = makeMenu();
    injectInto(wrap, specs, stageMenuAdapter);
    expect(ourRows(wrap.querySelector('ul.menu-children')!)).toHaveLength(0);
  });

  it('leaves the host rows untouched', () => {
    const wrap = makeMenu();
    injectInto(wrap, specs, stageMenuAdapter);
    const labels = [
      ...wrap.querySelectorAll('ul.operate-list > li.operate-item > p')
    ].map(p => p.textContent?.trim());
    expect(labels.slice(0, HOST_ROWS)).toEqual([
      '重命名',
      '分享设计图',
      '删除'
    ]);
  });

  it('adds a divider above our block when the host last row has none', () => {
    const wrap = makeMenu(false);
    injectInto(wrap, specs, stageMenuAdapter);
    const rows = ourRows(wrap);
    expect(rows[0]?.firstElementChild?.tagName).toBe('HR');
    expect(rows[1]?.querySelector('hr')).toBeNull();
  });

  it('reuses the host divider that appending un-hides', () => {
    // `.operate-item:last-child hr{display:none}` stops applying to the host's
    // last row once ours follow it, so a second divider would double up.
    const wrap = makeMenu(true);
    injectInto(wrap, specs, stageMenuAdapter);
    expect(ourRows(wrap)[0]?.querySelector('hr')).toBeNull();
  });

  it('is idempotent for a menu it already touched', () => {
    const wrap = makeMenu();
    injectInto(wrap, specs, stageMenuAdapter);
    expect(injectInto(wrap, specs, stageMenuAdapter)).toBe(false);
    expect(ourRows(wrap)).toHaveLength(specs.length);
  });

  it('returns false when the operate list is missing', () => {
    const wrap = document.createElement('div');
    wrap.id = 'contextMenuWrap';
    expect(injectInto(wrap, specs, stageMenuAdapter)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run ecosystem/browser-extension/src/content/__tests__/menu-stage.spec.ts`
Expected: FAIL — `Failed to resolve import "../menu-stage"`

- [ ] **Step 3: 实现**

`ecosystem/browser-extension/src/content/menu-stage.ts`：

```ts
import { ITEM_ATTR, type MenuAdapter, type MenuItemSpec } from './menu';
import {
  STAGE_DIALOG_SELECTOR,
  STAGE_ITEM_CLASS,
  STAGE_LABEL_PREFIX,
  STAGE_LIST_SELECTOR
} from './stage-selectors';

/**
 * The host closes its menu from a bubbling document click whose target sits
 * outside the popover (ContextMenu.created), and clicking our own row never
 * qualifies — so the menu would stay open after an action.
 *
 * Removing #contextMenuWrap ourselves is NOT an option: Vue keeps `menuShow`
 * true, so the next right-click re-uses the now-detached node and the menu
 * never comes back.
 */
export function closeHostMenu(): void {
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/**
 * The stage menu is plain markup — `li.operate-item > p` — and the host styles
 * it with descendant selectors that ask only for those two, so a namespaced
 * class on the `p` keeps the font, padding and hover.
 */
export function buildStageRow(spec: MenuItemSpec): HTMLElement {
  const row = document.createElement('li');
  row.className = STAGE_ITEM_CLASS;
  row.setAttribute(ITEM_ATTR, spec.id);

  const label = document.createElement('p');
  label.className = `${STAGE_LABEL_PREFIX}${spec.id}`;
  label.textContent = spec.label;
  // The popover is a hard 184px and rows are a fixed 32px line box with no
  // nowrap of their own, so a wrapped label overlaps the row below it.
  label.style.whiteSpace = 'nowrap';
  label.style.overflow = 'hidden';
  label.style.textOverflow = 'ellipsis';
  row.append(label);

  row.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    spec.onSelect();
    closeHostMenu();
  });

  return row;
}

export function insertStageRows(list: Element, specs: MenuItemSpec[]): void {
  const hostLast = list.lastElementChild;
  const rows = specs.map(buildStageRow);

  // `.operate-item:last-child hr{display:none}` stops matching the host's last
  // row once ours follow it, so its own divider reappears and separates the
  // block for free. Only synthesize one when that row carries none.
  const first = rows[0];
  if (first && hostLast && !hostLast.querySelector('hr')) {
    first.prepend(document.createElement('hr'));
  }

  list.append(...rows);
}

export const stageMenuAdapter: MenuAdapter = {
  dialogSelector: STAGE_DIALOG_SELECTOR,
  listSelector: STAGE_LIST_SELECTOR,
  insert: insertStageRows
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run ecosystem/browser-extension/src/content/__tests__/menu-stage.spec.ts`
Expected: 16 tests PASS

- [ ] **Step 5: Commit**

```bash
git add ecosystem/browser-extension/src/content/menu-stage.ts ecosystem/browser-extension/src/content/__tests__/menu-stage.spec.ts
git commit -m "feat(extension): add the stage page context menu dialect"
```

---

### Task 4: 从导航树反查右键目标 image_id

> Task 1 已真机确认这条反查链路成立（`node-id` = `image_id`，单选恰好一个 `.is-current`），本任务照常执行。

**Files:**
- Create: `ecosystem/browser-extension/src/content/stage-target.ts`
- Test: `ecosystem/browser-extension/src/content/__tests__/stage-target.spec.ts`

**Interfaces:**
- Consumes: `STAGE_DESIGN_MENU_MARKER` / `STAGE_TREE_CURRENT_SELECTOR` / `STAGE_TREE_ID_ATTR`（Task 1）
- Produces: `readStageImageId(root: ParentNode): string | null`

- [ ] **Step 1: 写失败测试**

`ecosystem/browser-extension/src/content/__tests__/stage-target.spec.ts`：

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readStageImageId } from '../stage-target';

/** Menu shape decides the target type: 分享设计图 only exists for a design. */
function addMenu(hasShareImg: boolean): void {
  const wrap = document.createElement('div');
  wrap.id = 'contextMenuWrap';
  wrap.innerHTML = `
    <ul class="operate-list">
      ${hasShareImg ? '<li class="operate-item"><p class="shareImg">分享设计图</p></li>' : ''}
      <li class="operate-item"><p class="paste">粘贴</p></li>
    </ul>`;
  document.body.append(wrap);
}

function addTree(
  nodes: { id: string; current: boolean; leaf?: boolean }[]
): void {
  const root = document.createElement('div');
  root.id = 'navTreeRoot';
  root.innerHTML = nodes
    .map(node => {
      const classes = ['l-tree-node', 'project-nav-tree-node'];
      if (node.current) classes.push('is-current');
      // Measured: design rows carry is-leafstate, group rows do not.
      if (node.leaf !== false) classes.push('is-leafstate');
      return `<div class="${classes.join(' ')}" node-id="${
        node.id
      }" node-layer="uuid-${node.id}"></div>`;
    })
    .join('');
  document.body.append(root);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('readStageImageId', () => {
  it('reads node-id from the single selected tree row', () => {
    addMenu(true);
    addTree([
      { id: 'img-1', current: false },
      { id: 'img-2', current: true }
    ]);
    expect(readStageImageId(document)).toBe('img-2');
  });

  it('returns null when the menu has no 分享设计图 entry', () => {
    // Blank-area and group right-clicks get a refresh/paste menu, and the tree
    // row for a group carries a group uuid — never an image id.
    addMenu(false);
    addTree([{ id: 'group-uuid', current: true }]);
    expect(readStageImageId(document)).toBeNull();
  });

  it('returns null when the selected row is a group, not a design', () => {
    // The nav tree's ⋯ button opens this same menu for group rows too, and a
    // group's node-id is a client-generated uuid — building a link from it
    // would point at nothing.
    addMenu(true);
    addTree([{ id: 'group-uuid', current: true, leaf: false }]);
    expect(readStageImageId(document)).toBeNull();
  });

  it('returns null when nothing is selected', () => {
    addMenu(true);
    addTree([{ id: 'img-1', current: false }]);
    expect(readStageImageId(document)).toBeNull();
  });

  it('returns null on a multi-selection', () => {
    addMenu(true);
    addTree([
      { id: 'img-1', current: true },
      { id: 'img-2', current: true }
    ]);
    expect(readStageImageId(document)).toBeNull();
  });

  it('returns null when there is no nav tree at all', () => {
    addMenu(true);
    expect(readStageImageId(document)).toBeNull();
  });

  it('returns null on the detail page, which has neither marker', () => {
    expect(readStageImageId(document)).toBeNull();
  });

  it('ignores a blank node-id', () => {
    addMenu(true);
    addTree([{ id: '   ', current: true }]);
    expect(readStageImageId(document)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run ecosystem/browser-extension/src/content/__tests__/stage-target.spec.ts`
Expected: FAIL — `Failed to resolve import "../stage-target"`

- [ ] **Step 3: 实现**

`ecosystem/browser-extension/src/content/stage-target.ts`：

```ts
import {
  STAGE_DESIGN_MENU_MARKER,
  STAGE_TREE_CURRENT_SELECTOR,
  STAGE_TREE_ID_ATTR
} from './stage-selectors';

/**
 * Stage draws its design cards with fabric.js, so there is no per-card DOM to
 * hit-test and the right-click target lives only on a JS object. The left nav
 * tree is the one DOM mirror of the canvas selection: selecting an object puts
 * `.is-current` on its row, and that row's `node-id` is the design's image_id.
 *
 * This also covers the tree's own ⋯ button, which opens the very same menu.
 *
 * Returns null rather than guessing. A wrong id here would produce a link that
 * silently points at another design.
 */
export function readStageImageId(root: ParentNode): string | null {
  // Gate on the menu shape: the host only offers 分享设计图 when the target is a
  // design, so this rejects blank-area right-clicks.
  if (!root.querySelector(STAGE_DESIGN_MENU_MARKER)) return null;

  // The selector also demands `is-leafstate`, which keeps group rows — whose
  // node-id is a client-generated group uuid — out of the result.
  const rows = root.querySelectorAll(STAGE_TREE_CURRENT_SELECTOR);
  // 0 = nothing selected; >1 = multi-selection, where "the" design is ambiguous.
  if (rows.length !== 1) return null;

  const id = rows[0]?.getAttribute(STAGE_TREE_ID_ATTR)?.trim();
  return id ? id : null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run ecosystem/browser-extension/src/content/__tests__/stage-target.spec.ts`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add ecosystem/browser-extension/src/content/stage-target.ts ecosystem/browser-extension/src/content/__tests__/stage-target.spec.ts
git commit -m "feat(extension): resolve the stage right-click target from the nav tree"
```

---

### Task 5: url.ts 支持外部 imageId、teamId 别名与 project_id

三处独立改进，共用一套测试：① stage 页 URL 没有 `image_id`，需要外部传入；② 现有别名漏了驼峰 `teamId`（stage 页切项目后 URL 用的正是它）；③ 拼链接补上 `project_id`（详情页 `project.id` 的唯一初始来源）。顺带抽出 `resolveDesignRefParts` 供 Task 8 报出"到底缺哪个参数"。

**Files:**
- Modify: `ecosystem/browser-extension/src/shared/url.ts`
- Modify: `ecosystem/browser-extension/src/shared/__tests__/url.spec.ts`

**Interfaces:**
- Consumes: `DESIGN_DETAIL_PATH` / `LANHU_ORIGIN`
- Produces:
  - `interface DesignRefParts { teamId: string | null; projectId: string | null; imageId: string | null }`
  - `resolveDesignRefParts(href: string, storage: StorageLike, imageIdOverride?: string | null): DesignRefParts`
  - `resolveDesignRef(href: string, storage: StorageLike, imageIdOverride?: string | null): DesignRef | null`（签名向后兼容）
  - `buildDesignUrl(ref: DesignRef): string`（输出新增 `project_id`）

- [ ] **Step 1: 追加失败测试**

在 `ecosystem/browser-extension/src/shared/__tests__/url.spec.ts` 末尾追加（并把 import 行补上 `resolveDesignRefParts`）：

```ts
describe('resolveDesignRef — stage page support', () => {
  const emptyStorage = { getItem: () => null };

  it('takes the image id from the caller when the url has none', () => {
    const href = 'https://lanhuapp.com/web/#/item/project/stage?tid=T&pid=P';
    expect(resolveDesignRef(href, emptyStorage, 'IMG')).toEqual({
      teamId: 'T',
      projectId: 'P',
      imageId: 'IMG'
    });
  });

  it('prefers the caller image id over the one in the url', () => {
    // The right-clicked design is more specific than the address bar.
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T&pid=P&image_id=FROM_URL';
    expect(resolveDesignRef(href, emptyStorage, 'FROM_CLICK')?.imageId).toBe(
      'FROM_CLICK'
    );
  });

  it('falls back to the url when the caller passes a placeholder', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T&pid=P&image_id=I';
    expect(resolveDesignRef(href, emptyStorage, 'undefined')?.imageId).toBe('I');
    expect(resolveDesignRef(href, emptyStorage, null)?.imageId).toBe('I');
  });

  it('accepts the camelCase teamId the stage page rewrites urls to', () => {
    // changeProject rebuilds the query as {type, pid, teamId} — tid is dropped.
    const href = 'https://lanhuapp.com/web/#/item/project/stage?teamId=T&pid=P';
    expect(resolveDesignRef(href, emptyStorage, 'IMG')?.teamId).toBe('T');
  });

  it('still returns null when no image id is available anywhere', () => {
    const href = 'https://lanhuapp.com/web/#/item/project/stage?tid=T&pid=P';
    expect(resolveDesignRef(href, emptyStorage, null)).toBeNull();
  });
});

describe('resolveDesignRefParts', () => {
  const emptyStorage = { getItem: () => null };

  it('reports exactly which ids are missing', () => {
    const href = 'https://lanhuapp.com/web/#/item/project/stage?pid=P';
    expect(resolveDesignRefParts(href, emptyStorage, null)).toEqual({
      teamId: null,
      projectId: 'P',
      imageId: null
    });
  });

  it('agrees with resolveDesignRef when everything resolves', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T&pid=P&image_id=I';
    expect(resolveDesignRefParts(href, emptyStorage)).toEqual({
      teamId: 'T',
      projectId: 'P',
      imageId: 'I'
    });
  });
});
```

再把既有的 `buildDesignUrl` 断言改为包含 `project_id`。`describe('buildDesignUrl', …)` 内只有**一处**硬编码输出断言（`url.spec.ts:150-153`），替换为下面这段；**文件顶部第 11 行的 `HREF` 常量是解析用的输入，保持不动**：

```ts
  it('builds a canonical detailDetach url', () => {
    // project_id rides along because the detail page seeds `project.id` from
    // it; with only pid that field starts out undefined. Lanhu itself always
    // sends both.
    expect(buildDesignUrl(ref)).toBe(
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T1&pid=P1&project_id=P1&image_id=I1'
    );
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run ecosystem/browser-extension/src/shared/__tests__/url.spec.ts`
Expected: FAIL — `resolveDesignRefParts is not a function`，以及 `buildDesignUrl` 的 URL 断言不匹配

- [ ] **Step 3: 实现**

修改 `ecosystem/browser-extension/src/shared/url.ts`：把 `resolveDesignRef` 整个函数（含其上方注释）替换为下面三段，并替换 `buildDesignUrl` 的实现：

```ts
export interface DesignRefParts {
  teamId: string | null;
  projectId: string | null;
  imageId: string | null;
}

/**
 * Mirrors lanhu's own getTeamId()/_getPID() chains: url first, then
 * localStorage.
 *
 * This is not defensive padding — both pages rewrite their own query. On
 * detailDetach, MarkLeft.changeUrlQuery drops `tid` when the user switches
 * designs; on stage, changeProject rebuilds the query as {type, pid, teamId},
 * dropping `tid` and switching to the camelCase spelling.
 *
 * `imageIdOverride` carries the right-clicked design on the stage page, where
 * the url has no image id at all. It wins over the url because a click target
 * is more specific than the address bar.
 */
export function resolveDesignRefParts(
  href: string,
  storage: StorageLike,
  imageIdOverride?: string | null
): DesignRefParts {
  const params = parseHashParams(href);

  const fromUrl = (...keys: string[]): string | null => {
    if (!params) return null;
    for (const key of keys) {
      const value = clean(params.get(key));
      if (value) return value;
    }
    return null;
  };

  const fromStorage = (key: string): string | null => {
    try {
      return clean(storage.getItem(key));
    } catch {
      // Storage access can throw when the page blocks it.
      return null;
    }
  };

  return {
    teamId: fromUrl('tid', 'teamId', 'team_id') ?? fromStorage('team_id'),
    projectId: fromUrl('pid', 'project_id') ?? fromStorage('pid'),
    // No storage fallback for the image id: a stale stored value would
    // silently reference the wrong design.
    imageId: clean(imageIdOverride) ?? fromUrl('image_id', 'docId')
  };
}

export function resolveDesignRef(
  href: string,
  storage: StorageLike,
  imageIdOverride?: string | null
): DesignRef | null {
  const { teamId, projectId, imageId } = resolveDesignRefParts(
    href,
    storage,
    imageIdOverride
  );
  if (!teamId || !projectId || !imageId) return null;
  return { teamId, projectId, imageId };
}

/**
 * Rebuilds the canonical form — including the `tid` the live url may have
 * dropped. `project_id` duplicates `pid` on purpose: the detail page seeds
 * `project.id` from it and starts out undefined without it, and lanhu's own
 * links always carry both. Everything else lanhu appends (comment_id,
 * version_id, fromEditor, …) is dropped: version_id only ever serves comment
 * anchoring, and nothing in a link encodes "the version I was looking at".
 */
export function buildDesignUrl(ref: DesignRef): string {
  const params = new URLSearchParams({
    tid: ref.teamId,
    pid: ref.projectId,
    project_id: ref.projectId,
    image_id: ref.imageId
  });
  return `${LANHU_ORIGIN}/web/#/${DESIGN_DETAIL_PATH}?${params.toString()}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run ecosystem/browser-extension/src/shared/__tests__/url.spec.ts`
Expected: 全部 PASS（原有用例 + 新增 7 个）

- [ ] **Step 5: Commit**

```bash
git add ecosystem/browser-extension/src/shared/url.ts ecosystem/browser-extension/src/shared/__tests__/url.spec.ts
git commit -m "feat(extension): accept an external image id and the teamId alias"
```

---

### Task 6: 消息通道容错

现状缺陷：`index.ts` 的 `ask()` 直接把 `chrome.runtime.sendMessage` 的 Promise 抛给调用方，而菜单项写作 `onSelect: () => void copyCookies()`，**被丢弃的 rejection 不会触发任何 toast**。在 `chrome://extensions` 重新加载扩展但没刷新页面时，`sendMessage` 抛 `Extension context invalidated`，用户点菜单**完全没反应**。本任务把它抽成可测模块并兜住异常。

**Files:**
- Create: `ecosystem/browser-extension/src/content/messaging.ts`
- Test: `ecosystem/browser-extension/src/content/__tests__/messaging.spec.ts`

**Interfaces:**
- Consumes: `BackgroundMessage` / `BackgroundReply`（`shared/protocol.ts`）
- Produces: `ask(message: BackgroundMessage): Promise<BackgroundReply>`

- [ ] **Step 1: 写失败测试**

`ecosystem/browser-extension/src/content/__tests__/messaging.spec.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ask } from '../messaging';

function stubSendMessage(impl: () => Promise<unknown>): void {
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(impl) } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ask', () => {
  it('passes the reply through untouched', async () => {
    stubSendMessage(async () => ({ ok: true, token: 'sid=FAKE' }));
    await expect(ask({ type: 'copy-cookies' })).resolves.toEqual({
      ok: true,
      token: 'sid=FAKE'
    });
  });

  it('turns an invalidated context into an actionable reply', async () => {
    // Reloading the extension without refreshing the tab kills this port; the
    // click must not die silently.
    stubSendMessage(async () => {
      throw new Error('Extension context invalidated.');
    });
    const reply = await ask({ type: 'copy-cookies' });
    expect(reply.ok).toBe(false);
    expect(reply.ok === false && reply.error).toContain('刷新页面');
  });

  it('reports a missing receiver the same way', async () => {
    stubSendMessage(async () => {
      throw new Error(
        'Could not establish connection. Receiving end does not exist.'
      );
    });
    const reply = await ask({ type: 'send-cookies' });
    expect(reply.ok).toBe(false);
    expect(reply.ok === false && reply.error).toContain('刷新页面');
  });

  it('surfaces any other failure verbatim', async () => {
    stubSendMessage(async () => {
      throw new Error('boom');
    });
    const reply = await ask({ type: 'send-cookies' });
    expect(reply).toEqual({ ok: false, error: 'boom' });
  });

  it('survives a synchronous throw', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: () => {
          throw new Error('Extension context invalidated.');
        }
      }
    });
    await expect(ask({ type: 'copy-cookies' })).resolves.toMatchObject({
      ok: false
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run ecosystem/browser-extension/src/content/__tests__/messaging.spec.ts`
Expected: FAIL — `Failed to resolve import "../messaging"`

- [ ] **Step 3: 实现**

`ecosystem/browser-extension/src/content/messaging.ts`：

```ts
import type { BackgroundMessage, BackgroundReply } from '../shared/protocol';

/** Reloading the extension leaves old content scripts with a dead port. */
const DEAD_PORT = /context invalidated|Receiving end does not exist/i;

/**
 * Never rejects. Menu handlers are fire-and-forget (`() => void action()`), so
 * a rejection here would be swallowed as an unhandled rejection and the click
 * would look like it did nothing at all.
 */
export async function ask(
  message: BackgroundMessage
): Promise<BackgroundReply> {
  try {
    return (await chrome.runtime.sendMessage(message)) as BackgroundReply;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: DEAD_PORT.test(reason) ? '扩展已更新，请刷新页面后重试' : reason
    };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run ecosystem/browser-extension/src/content/__tests__/messaging.spec.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add ecosystem/browser-extension/src/content/messaging.ts ecosystem/browser-extension/src/content/__tests__/messaging.spec.ts
git commit -m "fix(extension): stop silently swallowing a dead service worker port"
```

---

### Task 7: 菜单定位修正

宿主用 `32 * menuItem.length + 16 + 21 * divideCount` 估算菜单高度来决定向上还是向下展开，**我们追加的行不在它的账里**（约 +102px）。在视口底部附近右键时宿主判定"放得下"，实际内容超出视口且 `position:fixed` 无滚动，**我们的菜单项被裁掉看不见**。

**Files:**
- Create: `ecosystem/browser-extension/src/content/position.ts`
- Test: `ecosystem/browser-extension/src/content/__tests__/position.spec.ts`
- Modify: `ecosystem/browser-extension/src/content/menu-stage.ts`

**Interfaces:**
- Consumes: 无
- Produces: `interface MenuBox { top: number; height: number }`、`correctedTop(box: MenuBox, viewportHeight: number, margin?: number): number | null`

- [ ] **Step 1: 写失败测试**

`ecosystem/browser-extension/src/content/__tests__/position.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { correctedTop } from '../position';

describe('correctedTop', () => {
  it('leaves a menu that already fits alone', () => {
    expect(correctedTop({ top: 100, height: 200 }, 800)).toBeNull();
  });

  it('lifts a menu that overflows the bottom edge', () => {
    // 700 + 200 + 8 - 800 = 108 over.
    expect(correctedTop({ top: 700, height: 200 }, 800)).toBe(592);
  });

  it('clamps to the top margin rather than going off-screen', () => {
    expect(correctedTop({ top: 700, height: 900 }, 800)).toBe(8);
  });

  it('honours a custom margin', () => {
    expect(correctedTop({ top: 700, height: 200 }, 800, 0)).toBe(600);
  });

  it('treats an exactly-fitting menu as fitting', () => {
    expect(correctedTop({ top: 592, height: 200 }, 800)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run ecosystem/browser-extension/src/content/__tests__/position.spec.ts`
Expected: FAIL — `Failed to resolve import "../position"`

- [ ] **Step 3: 实现纯函数**

`ecosystem/browser-extension/src/content/position.ts`：

```ts
export interface MenuBox {
  top: number;
  height: number;
}

/**
 * The host picks the popover's top from `menuItem.length` alone, so the rows we
 * append are invisible to its flip-up decision. It is `position:fixed` with no
 * scrolling, so an underestimate means our rows are simply clipped away.
 *
 * Returns the corrected top, or null when no correction is needed.
 */
export function correctedTop(
  box: MenuBox,
  viewportHeight: number,
  margin = 8
): number | null {
  const overflow = box.top + box.height + margin - viewportHeight;
  if (overflow <= 0) return null;
  return Math.max(margin, box.top - overflow);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run ecosystem/browser-extension/src/content/__tests__/position.spec.ts`
Expected: 5 tests PASS

- [ ] **Step 5: 在 stage 适配器里接上**

修改 `ecosystem/browser-extension/src/content/menu-stage.ts`：import 区加入

```ts
import { correctedTop } from './position';
```

并在 `insertStageRows` 的 `list.append(...rows);` 之后追加：

```ts
  keepMenuInViewport(list.closest(STAGE_DIALOG_SELECTOR));
```

在文件末尾（`stageMenuAdapter` 之前）加入：

```ts
/**
 * Applied once, right after injection. Vue re-patches the popover's inline
 * style whenever a submenu opens, which reverts this — acceptable, since the
 * submenus belong to host actions we are not part of.
 */
function keepMenuInViewport(dialog: Element | null): void {
  if (!(dialog instanceof HTMLElement)) return;
  const box = dialog.getBoundingClientRect();
  // jsdom reports zeros; a zero-height box never overflows, so tests are inert.
  const top = correctedTop({ top: box.top, height: box.height }, innerHeight);
  if (top === null) return;
  dialog.style.top = `${top}px`;
  dialog.style.bottom = 'unset';
}
```

- [ ] **Step 6: 跑全部 content 测试确认无回归**

Run: `pnpm vitest run ecosystem/browser-extension/src/content`
Expected: 全部 PASS（Task 3 的 16 个仍然通过——jsdom 的 rect 全 0，修正逻辑不触发）

- [ ] **Step 7: Commit**

```bash
git add ecosystem/browser-extension/src/content/position.ts ecosystem/browser-extension/src/content/__tests__/position.spec.ts ecosystem/browser-extension/src/content/menu-stage.ts
git commit -m "fix(extension): keep the stage menu on screen after injecting rows"
```

---

### Task 8: 接线与手动验收

**Files:**
- Modify: `ecosystem/browser-extension/src/content/index.ts`

**Interfaces:**
- Consumes: `installMenuInjector` / `MenuItemSpec`（T2）、`detailMenuAdapter`（T2）、`stageMenuAdapter`（T3）、`readStageImageId`（T4）、`resolveDesignRefParts` / `buildDesignUrl`（T5）、`ask`（T6）、`copyText`
- Produces: 可加载的扩展产物

- [ ] **Step 1: 重写 content script 入口**

`ecosystem/browser-extension/src/content/index.ts`（**整文件替换**）：

```ts
import {
  buildDesignUrl,
  type DesignRefParts,
  resolveDesignRefParts
} from '../shared/url';
import { copyText } from './clipboard';
import { installMenuInjector, type MenuItemSpec } from './menu';
import { detailMenuAdapter } from './menu-detail';
import { stageMenuAdapter } from './menu-stage';
import { ask } from './messaging';
import { readStageImageId } from './stage-target';

function toast(message: string): void {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = [
    'position:fixed',
    'z-index:99999',
    'left:50%',
    'top:24px',
    'transform:translateX(-50%)',
    'padding:8px 16px',
    'border-radius:4px',
    'background:rgba(0,0,0,.82)',
    'color:#fff',
    'font-size:13px',
    'pointer-events:none'
  ].join(';');
  document.body.append(el);
  setTimeout(() => el.remove(), 2400);
}

const PARAM_LABELS: Record<keyof DesignRefParts, string> = {
  teamId: 'tid',
  projectId: 'pid',
  imageId: 'image_id'
};

async function copyDesignUrl(): Promise<void> {
  // Content scripts share the page origin, so this is the same localStorage
  // lanhu itself falls back to. On stage the url carries no image id at all —
  // readStageImageId digs the right-clicked design out of the nav tree, and
  // returns null on the detail page, where the url already has one.
  const parts = resolveDesignRefParts(
    location.href,
    localStorage,
    readStageImageId(document)
  );
  const missing = (
    Object.keys(PARAM_LABELS) as (keyof DesignRefParts)[]
  ).filter(key => !parts[key]);

  if (missing.length > 0) {
    toast(
      `未识别到设计稿参数：缺少 ${missing
        .map(key => PARAM_LABELS[key])
        .join(' / ')}`
    );
    return;
  }

  const url = buildDesignUrl({
    teamId: parts.teamId as string,
    projectId: parts.projectId as string,
    imageId: parts.imageId as string
  });
  const ok = await copyText(url);
  toast(ok ? '已复制设计稿链接' : '复制失败，请检查剪贴板权限');
}

async function copyCookies(): Promise<void> {
  const reply = await ask({ type: 'copy-cookies' });
  if (!reply.ok) {
    toast(`获取 Cookie 失败：${reply.error}`);
    return;
  }
  if (!reply.token) {
    toast('获取 Cookie 失败：返回为空');
    return;
  }
  const ok = await copyText(reply.token);
  toast(ok ? '已复制 Cookie，可粘贴到 lanhu auth set' : '复制失败');
}

async function sendCookies(): Promise<void> {
  const reply = await ask({ type: 'send-cookies' });
  toast(
    reply.ok ? '已发送到本机 lanhu auth listen' : `发送失败：${reply.error}`
  );
}

const specs: MenuItemSpec[] = [
  {
    id: 'copy-design-url',
    label: '复制选中设计稿链接',
    badge: 'CLI',
    onSelect: () => void copyDesignUrl()
  },
  {
    id: 'copy-cookies',
    label: '复制 cookies',
    badge: 'CLI',
    onSelect: () => void copyCookies()
  },
  {
    id: 'send-cookies',
    label: '发送 cookies 到本机',
    badge: 'CLI',
    onSelect: () => void sendCookies()
  }
];

// Both adapters are installed unconditionally; each claims its own menu by
// selector, so detailDetach and stage need no route detection.
installMenuInjector(document.body, specs, [detailMenuAdapter, stageMenuAdapter]);
```

- [ ] **Step 2: 类型检查与构建**

Run: `pnpm --filter @lanhu-context/browser-extension typecheck`
Expected: 无错误

Run: `pnpm --filter @lanhu-context/browser-extension build`
Expected: `dist/` 下产出 `background.js`、`content.js`、`manifest.json`

- [ ] **Step 3: 手动验收 —— 详情页无回归**

1. `chrome://extensions` 重新加载扩展，刷新蓝湖标签页
2. 打开任意 `detailDetach` 设计稿页并右键
3. 断言：菜单底部仍有三个带 `CLI` 徽标的菜单项
4. 点「复制选中设计稿链接」→ 粘贴，断言形如
   `https://lanhuapp.com/web/#/item/project/detailDetach?tid=..&pid=..&project_id=..&image_id=..`
5. 用该 URL 跑 `node packages/cli/dist/main.js parse "<粘贴的URL>"`，断言解析出三元组且退出码 0

- [ ] **Step 4: 手动验收 —— stage 页三项可用**

1. 打开 `#/item/project/stage` 页面
2. **右键一张设计图**：断言菜单底部出现三个新菜单项，且上方有一条分隔线
3. 点「复制选中设计稿链接」→ 断言 toast 显示「已复制设计稿链接」，**且菜单随即关闭**
4. 粘贴该链接，断言其 `image_id` 与双击进入该设计图后地址栏里的 `image_id` **一致**
5. 关闭菜单再次右键，重复第 2 步——断言菜单项仍然出现（验证重注入）
6. 点「复制 cookies」→ 粘贴到**临时文件**（勿提交），断言含多个 `k=v; ` 段
7. 终端跑 `node packages/cli/dist/main.js auth listen --timeout 60`，点「发送 cookies 到本机」→ 断言 toast 显示已发送、终端收到并写入

- [ ] **Step 5: 手动验收 —— 负例与边界**

1. **右键空白画布区**：断言菜单只有「刷新/粘贴」+ 我们三项；点「复制选中设计稿链接」→ 断言 toast 提示缺少 `image_id`，**不产生错误链接**
2. **导航树「⋯」菜单（设计图）**：点某个设计图节点的 ⋯ → 断言三项照常出现（实测它复用同一个 `#contextMenuWrap`，本就该被覆盖），且复制出的链接指向**该**设计图
3. **导航树「⋯」菜单（分组）**：点一个**分组**节点的 ⋯ → 点「复制选中设计稿链接」→ 断言提示缺少 `image_id`。**这是 `is-leafstate` 判据的专项验收：绝不能复制出分组 uuid。**
4. **框选多张后右键**：断言同样提示缺少 `image_id`
5. **视口底部右键**：在靠近浏览器窗口底边处右键一张设计图，断言我们的三项**可见未被裁切**
6. **端口容错**：在 `chrome://extensions` 点扩展的「重新加载」但**不刷新**蓝湖页面，然后点「复制 cookies」→ 断言 toast 显示「扩展已更新，请刷新页面后重试」（修复前是毫无反应）

- [ ] **Step 6: Commit**

```bash
git add ecosystem/browser-extension/src/content/index.ts
git commit -m "feat(extension): wire the menu items into the stage page"
```

---

### Task 9: 文档同步与全量校验

**Files:**
- Modify: `ecosystem/browser-extension/public/manifest.json`
- Modify: `ecosystem/browser-extension/README.md`
- Modify: `ecosystem/browser-extension/CLAUDE.md`
- Modify: `ecosystem/browser-extension/docs/NOTES.md`

- [ ] **Step 1: 更新 manifest 文案**

`ecosystem/browser-extension/public/manifest.json` 的 `description` 改为：

```json
  "description": "在蓝湖设计稿详情页与画布页复制设计稿链接与登录 Cookie，配合 lanhu-context CLI 使用。",
```

**不要动 `matches`**：`https://lanhuapp.com/web/*` 已覆盖两个页面（hash 不参与匹配）。

- [ ] **Step 2: 更新扩展 README**

在 `ecosystem/browser-extension/README.md` 中：

1. 开头一句改为说明支持**两个页面**：设计稿详情页（`detailDetach`）与项目画布页（`stage`）。
2. 「三个菜单项」小节补一列或一段说明两页差异：
   - detailDetach：设计稿 id 取自地址栏
   - stage：设计稿 id 取自左侧画板导航树的选中项，**因此需要右键的是一张设计图**（右键空白/分组/多选会提示缺少 `image_id`），且导航树被收起时不可用
3. 新增一小段「已知限制」，列出：多选时不复制链接、折叠分组依赖宿主自动展开、二级菜单展开会让菜单定位修正失效。

- [ ] **Step 3: 更新包级 CLAUDE.md 硬性约束**

在 `ecosystem/browser-extension/CLAUDE.md` 的「硬性约束」里追加四条：

- **严禁自行移除 `#contextMenuWrap`**：宿主 `menuShow` 仍为 true，下次右键不会重渲染，菜单将永久消失；关闭菜单必须派发一个 target 在菜单外的 click 让宿主自己关。
- **stage 菜单的容器是 `ul.operate-list`**，`#contextMenuWrap` 下另有 `ul.menu-children` 二级菜单，勿注入其中；且有两个组件渲染同一个 id，按 id 认菜单、不绑组件。
- **注入项 `<p>` 的 class 必须 `lanhu-ext-` 前缀**，不得复用宿主 action 名（`p.delete` 变红、`p.active` 是子菜单高亮）；`li` 必须保留 `operate-item` class 才继承样式。
- **stage 页设计稿 id 只能从导航树 `#navTreeRoot .l-tree-node.is-current.is-leafstate[node-id]` 反查**（canvas 无卡片 DOM）。两个闸门缺一不可：菜单里存在 `p.shareImg`（排除空白区右键）、节点带 `is-leafstate`（排除分组——导航树的「⋯」菜单复用同一套 DOM，分组也有这个入口）。

并把「架构」一节改为说明适配器结构（`menu.ts` 通用 + `menu-detail.ts` / `menu-stage.ts` 两种方言）。

- [ ] **Step 4: 补齐 NOTES.md**

确认 Task 1 Step 8 写入的 stage 侦察记录完整；补上本轮新增的两条结论：`buildDesignUrl` 为何带 `project_id`、`version_id` 为何确定不带（蓝湖查看历史版本不写 URL，链接无法编码"当时看的版本"）。

- [ ] **Step 5: 全量校验**

Run: `pnpm lint`
Run: `pnpm typecheck`
Run: `pnpm test`
Run: `pnpm build`
Expected: 全部通过。若 `pnpm lint` 报格式问题，跑 `pnpm lint:fix` 后**重跑测试**再提交。

- [ ] **Step 6: Commit**

```bash
git add ecosystem/browser-extension/public/manifest.json ecosystem/browser-extension/README.md ecosystem/browser-extension/CLAUDE.md ecosystem/browser-extension/docs/NOTES.md
git commit -m "docs(extension): document stage page support and its constraints"
```

- [ ] **Step 7: 归档本计划**

```bash
git mv plan.md ecosystem/browser-extension/docs/implementation-plan-stage-menu.md
git add ecosystem/browser-extension/docs/implementation-plan-stage-menu.md
git commit -m "docs(extension): archive the stage menu implementation plan"
```

---

## 风险与回退

| 风险 | 触发条件 | 应对 |
| --- | --- | --- |
| 导航树被用户收起 | 用户折叠了左侧面板 | `readStageImageId` 返回 null，toast 提示缺少 `image_id`；README 记为已知限制 |
| 分组的「⋯」菜单误取分组 uuid | 分组行拿到 `.is-current` 且菜单含 `p.shareImg` | 选择器强制要求 `is-leafstate`（分组行没有）；Task 8 Step 5 第 3 条专项验收。**若该验收失败**，改为在 `#navTreeRoot` 上捕获阶段监听 click、点 ⋯ 时用 `closest('.l-tree-node[node-id]')` 记录目标节点，优先于 `.is-current` 使用 |
| 蓝湖改版导致选择器失效 | 未来某次发版 | `injectInto` 找不到 `ul.operate-list` 时返回 `false` 而非抛错；按 Task 1 的 Console 脚本重测并更新 `stage-selectors.ts`，业务逻辑无需改动 |
| Vue 重渲染吃掉注入项 | 同一次菜单打开期间宿主重渲染列表 | 注入器的幂等判据是"我们的行是否还在"，观察器每批变更做合并扫描，会自动补回（Task 2 Step 5 的测试锁住该行为） |
| 菜单定位修正被还原 | 用户 hover「移动至分组」等带二级菜单的宿主项 | 宿主重写 inline style，修正失效；属于宿主自身动作路径，记为已知限制不再对抗 |
| 我们的 click 让宿主退出全屏模式 | 每次点击我们的菜单项 | `#canvas-area` 的 `v-click-outside` 会触发 `exitAllMode`——但点宿主自己的菜单项行为完全相同，不是新引入的副作用 |
| 同时装了第三方注入器 | 用户装了带 `⚡MCP` 徽标的工具 | 本扩展只认 `data-lanhu-ext-*`，不检测也不移除他人节点；可能出现职能相近的重复条目，由产品侧决定 |

## Self-Review 记录

- **需求覆盖**：「stage 页也显示右键菜单、功能一样」由 Task 3（菜单方言）+ Task 4（设计稿 id 反查）+ Task 8（接线）共同满足；三个菜单项在 stage 页全部可用，与详情页完全等价——Task 1 的真机验证已确认导航树反查成立，无需降级。**导航树节点的「⋯」菜单实测复用同一个 `#contextMenuWrap`，被 stage 适配器自动覆盖，不需要第三个适配器**；其带来的唯一新风险（分组行的 uuid）由 `is-leafstate` 判据关闭。
- **顺带修复的既有缺陷**：`ask()` 吞异常导致点击无反应（Task 6）、报错文案不指出缺哪个参数（Task 8）、幂等标记会变陈旧（Task 2）、观察器只看 `addedNodes`（Task 2）、`teamId` 别名缺失（Task 5）、`project_id` 未透传（Task 5）。
- **明确不做**：`version_id` 保留（侦察确证蓝湖自身链接也无法编码"当时看的版本"，无正确性收益）；`world: "MAIN"`（导航树已提供纯 DOM 路径，且 MAIN 方案依赖压缩产物内部对象链）；`focusItem`（属于分享短链语义，detailDetach 路由不消费）；`chrome.contextMenus`（stage 页与详情页均全局 `preventDefault` 原生右键菜单）。
- **类型一致性**：`MenuItemSpec`（T2）在 T3/T8 消费签名一致；`MenuAdapter` 的 `insert(list, specs)` 由 `detailMenuAdapter`（T2）与 `stageMenuAdapter`（T3）各自实现、由 `injectInto`（T2）唯一调用；`ITEM_ATTR` 在 T2 定义、T3 写入、T2 查询；`DesignRefParts`（T5）在 T8 消费；`readStageImageId`（T4）的返回类型 `string | null` 正好匹配 `resolveDesignRefParts` 第三参 `string | null | undefined`。
- **不改 packages/**：CLI 与 core 零改动，因此不需要 changeset；`buildDesignUrl` 新增的 `project_id` 与 `parseLanhuUrl` 的 `pid || project_id` 兼容，两值相同不产生歧义。
