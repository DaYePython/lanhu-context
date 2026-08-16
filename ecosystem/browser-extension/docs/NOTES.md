# 真机侦察结论（2026-08-16）

页面：`https://lanhuapp.com/web/#/item/project/detailDetach?tid=…&pid=…&image_id=…`

本文件是 `src/content/selectors.ts` 的唯一依据。蓝湖前端改版导致注入失效时，重新按下面的方法复测并同步更新两个文件。

## 1. 原生右键菜单

**结论：被屏蔽。** 画布区右键不弹出 Chrome 原生菜单，蓝湖以 `preventDefault` 拦截后自绘 popover。

因此 `chrome.contextMenus` 注册的菜单项在画布区不会出现，三个功能必须以 DOM 形式注入蓝湖自己的菜单。

## 2. 菜单 DOM（实测）

| 常量 | 实测值 |
| --- | --- |
| `DIALOG_SELECTOR` | `.detail_context_menu_dialog`（同节点另有 `.mu-popover`） |
| `LIST_SELECTOR` | `.mu-menu-list` |
| `ITEM_SELECTOR` | `.mu-menu-item` |
| `WRAPPER_CLASS` | `mu-menu-item-wrapper` |
| `RIPPLE_CLASS` | `mu-ripple-wrapper` |
| `ITEM_CLASS` | `mu-menu-item` |
| `TITLE_BOX_CLASS` | `mu-menu-item-title` |
| `TITLE_CLASS` | `menu-item-title` |
| `BADGE_BOX_CLASS` | `key-icon` |
| `BADGE_CLASS` | `hotkey` |

### ⚠ 易错点：列表容器是 `.mu-menu-list` 而非 `.mu-menu`

层级是 `.detail_context_menu_dialog > .mu-menu > .mu-menu-list > <每一项>`。`.mu-menu` 只是带 `tabindex` 和宽度样式的外壳，直接往它上面 append 会让菜单项落在列表外面。

### 单个菜单项的真实结构

宿主原生项「返回」：

```html
<div>
  <div class="mu-menu-item-wrapper" tabindex="0"
       style="user-select: none; outline: none; cursor: pointer; appearance: none;">
    <div class="">
      <div class="mu-ripple-wrapper"></div>
      <div class="mu-menu-item">
        <!---->
        <div class="mu-menu-item-title"><span class="menu-item-title">返回</span></div>
        <div><!----> <span class="key-icon"><span class="hotkey">esc</span></span></div>
        <!---->
      </div>
    </div>
  </div>
  <!---->
</div>
```

注意嵌套有 5 层：**外层无 class 的 `div` → `.mu-menu-item-wrapper` → 无 class 的 `div` → 并列的 `.mu-ripple-wrapper` 与 `.mu-menu-item` → `.mu-menu-item-title` → `span.menu-item-title`**。标题不是 `.mu-menu-item` 的直接子节点。

### 列表完整顺序（实测时）

```
.mu-menu-list
├── <!---->                       ← v-if 占位（「选中图层」隐藏时）
├── 复制选中图层链接    [⚡MCP]    ← 第三方注入
├── 复制示例提示词      [⚡MCP]    ← 第三方注入
├── 设置提示词模板      [⚡MCP]    ← 第三方注入
├── 返回                [esc]      ← 宿主原生
├── 重新加载                        ← 宿主原生
└── 下载图片                        ← 宿主原生
```

## 3. ⚠ 现场已存在第三方注入器

实测时菜单里已有三项由其他工具注入的条目，通过 `data-*` 属性标记：

| 标记属性 | 标题 |
| --- | --- |
| `data-lanhu-helper-copy-link="1"` | 复制选中图层链接 |
| `data-lanhu-example-prompt="1"` | 复制示例提示词 |
| `data-lanhu-helper-settings="1"` | 设置提示词模板 |

标记同时打在**外层 div** 和 `.mu-menu-item-wrapper` 上，并用 `.hotkey` 显示 `⚡MCP` 徽标。

对本项目的两点影响：

1. **命名空间隔离**：本扩展的标记一律用 `data-lanhu-ext-*`，与上述 `data-lanhu-helper-*` / `data-lanhu-example-*` 不冲突。
2. **功能重叠**：该工具的「复制选中图层链接」与本扩展的「复制选中设计稿链接」职能相近。两者同时启用时菜单会出现两个相似条目——需要产品侧决定是否停用其一。本扩展不主动检测或移除他人注入的节点。

它同时证明了一件事：**往 `.mu-menu-list` 追加节点是可行的**，宿主不会把外来节点清掉。

## 4. URL 跟随设计稿切换 —— ⚠ 但 `tid` 会丢失

**结论：`image_id` 跟随切换，但 `tid` 在切换后从 URL 中消失。**

`design-detail/components/MarkLeft.vue:609-617` 在切换设计稿时整段替换 query：

```js
changeUrlQuery: function (t, e) {
  if (t.id !== this.$route.query.image_id) {
    var n = e || { pid: this.projectId, project_id: this.projectId, image_id: t.id };
    // …$router.push({ name: "detailDetach", query: n })
  }
}
```

新 query 只有 `{ pid, project_id, image_id }`。所以：

| 时机 | URL 是否含 `tid` |
| --- | --- |
| 从项目列表进入详情页 | ✅ 有 |
| 在页内切换到另一张设计稿 | ❌ 没有 |

只读 URL 的解析器会在最常见的路径上报「未识别到设计稿参数」。

### 蓝湖自己的 fallback 链

`getTeamId()` 在多处重复出现（`project-entry/api/msg-center-server.js:407`、`editor/components/ItemProjectEditor.vue:2047`、`item/mixins/notify-all.js:64` 等）：

```js
return this.$route.query.team_id || this.$route.query.tid || this.team_id || localStorage.team_id;
```

`project_id` 同样有兜底（`design-detail/api/project-sign-url.js:163`）：`project_id: i || localStorage.pid`。

### 取值表

| 字段 | URL 键（按优先级） | localStorage 兜底 |
| --- | --- | --- |
| teamId | `tid` → `team_id` | `team_id`（全仓 119 次引用） |
| projectId | `pid` → `project_id` | `pid`（55 次） |
| imageId | `image_id` → `docId` | **无（刻意不做）** |

`image_id` 不兜底：`changeUrlQuery` 保证它始终在 URL 里，而过期的存储值会静默指向错误的设计稿。

### ⚠ 存储值可能是垃圾

- `common/utils/tip-team.js:72` → `localStorage.team_id = "undefined"`（字面量字符串）
- `item/api/account-project.js:589` → `localStorage.pid = ""`

取值时必须把 `''` / `'undefined'` / `'null'` 一律视为缺失，否则会把字符串 `"undefined"` 当成合法 team id 拼进 URL。

### 对架构的影响

content script 运行在 ISOLATED world 时与页面**同源**，可直接读同一份 `localStorage`。因此这条修正**不需要**引入 `world: "MAIN"`。

## 5. 与计划中「逆向结论摘要」的差异

| 项 | 计划推断 | 实测 | 处理 |
| --- | --- | --- | --- |
| 列表容器 | `.mu-menu` | `.mu-menu-list` | 以实测为准 |
| 菜单项结构 | `.mu-menu-item` 直接包 `span.menu-item-title` | 5 层嵌套，中间有 `.mu-menu-item-title` | 以实测为准，`buildMenuItem` 按真实层级构造 |
| 徽标位置 | 未预见 | `.key-icon > .hotkey`，可选 | 新增 `MenuItemSpec.badge` 可选字段 |
| 原生右键菜单被屏蔽 | 是 | 是 | 一致 |
| URL 跟随切换 | 假定 `tid` 恒在 | `image_id` 跟随，**`tid` 切换后丢失** | 解析改为 URL + localStorage 两级 fallback，复刻蓝湖 `getTeamId()` |
| 存储值合法性 | 未预见 | 可能是 `"undefined"` / `""` | 取值统一过滤占位串 |

## 6. stage 页（#/item/project/stage）侦察结论

页面：`https://lanhuapp.com/web/#/item/project/stage?tid=…&pid=…`（2026-08-16 真机实测）。本节是 `src/content/stage-selectors.ts` 的唯一依据。

### 根本事实：canvas 无卡片 DOM，导航树是唯一 DOM 侧信道

stage 页的设计图由 fabric.js 画在 `<canvas id="stage">` 上，`#canvas-wrap` 下只有 `.temp-group` 与 `<canvas>` 两个子节点——**不存在每张图对应的 DOM 节点**；`#contextMenuWrap` 上也没有任何 `data-*` 携带右键目标；右键链路全程不写 URL，目标只活在页面 JS 对象里。ISOLATED world 能摸到的画布选中态镜像只有左侧画板导航树：

| 选择器 / 属性 | 含义 |
| --- | --- |
| `#navTreeRoot .l-tree-node[node-id]` | `node-id` = 设计图 `image_id`（实测树上有 5 个此类节点） |
| `.l-tree-node.is-current` | 画布选中态镜像；画布选中会驱动树节点加此 class |
| `is-leafstate` | 叶子（设计图）判据，分组行没有 |

### ⚠ 易错点：取 `node-id`，不是 `node-layer`

同一节点上还有 `node-layer` 属性，那是树内 uuid，与 `image_id` 无关。反查一律读 `node-id`。

### 四种场景实测

| 场景 | `hasShareImg` | `.is-current[node-id]` 数量 | 结论 |
| --- | --- | --- | --- |
| 右键一张设计图 | `true` | **1** | ✅ 可取，`node-id` = `image_id` |
| 右键空白画布区 | `false` | — | 被 `p.shareImg` 闸门拦截，反查须返回 null |
| 右键分组 | —— | —— | **分组没有右键菜单**（左键选中，不弹菜单），画布右键路径上不存在该场景 |
| 框选多张后右键 | `true` | **>1** | "哪一张"无从判断，被数量判据拦截，反查须返回 null |

### 核心断言：`node-id` = `image_id`

右键一张设计图时 `.is-current[node-id]` 恰好 **1** 个，其 `node-id` 为 `dacd1d67-8920-4b66-841b-83da92efc90d`，与双击进入该设计稿后地址栏的 `image_id` **完全相等**（uuid 形态）。

选中节点的完整 class 字符串：

```
l-tree-node project-nav-tree-node is-current is-leafstate is-focusable is-showoperaticon
```

`hasChildNodes: false`（行内不嵌套子树节点）。**`is-leafstate` 可作叶子判据**——区分设计图与分组行全靠它。

### 右键设计图时的完整菜单（12 项）

```
rename / moveToGroup / addToGroup / notifyMembers / copy / paste /
shareImg / downloadImg / downloadSlice / downloadCombineImg / setCover / delete
```

`listCount: 1`，即 `#contextMenuWrap` 下只有一个 `ul.operate-list`。⚠ 但 wrap 下另有 `ul.menu-children`（二级菜单容器，见 §A 抓取的 DOM），注入必须落在 `ul.operate-list`，塞进 `menu-children` 会把菜单项藏进子菜单。

「分享设计图」`p.shareImg` 只在右键目标是**设计图**时出现（右键空白实测为 `false`），因此它是"当前目标是设计图"的纯 DOM 闸门。

### 时序与折叠分组

- **时序无问题**：`#contextMenuWrap` 出现在 DOM（即 MutationObserver 能看到它）时，`.is-current` 已就绪且恰好 1 个——反查不需要等待或轮询。
- **折叠分组**：右键折叠分组内的设计图，宿主会自动展开其祖先分组，`currentCount === 1` 仍成立——不需要我们自己展开树。

### 导航树「⋯ 更多」按钮复用同一个菜单

导航树节点行上的「⋯ 更多」按钮打开的是**同一个** `#contextMenuWrap`（实测 `isContextMenuWrap: true`）：容器 id、`ul.operate-list`、`li.operate-item > p` 结构、12 项内容全部一致。**按 id 认菜单的 stage 适配器会自动覆盖这条入口，不需要单独写适配器。**

### ⚠ 易错点：分组也有「⋯」入口，靠 `is-leafstate` 排除

分组在画布上不弹右键菜单，但导航树的「⋯」对分组行同样可用——此时 `.is-current` 行的 `node-id` 是**客户端生成的分组 uuid**，不是 `image_id`，拼进链接会指向不存在的设计稿。反查选择器必须带 `is-leafstate` 判据（分组行没有该 class），这不是可选加固。

### 规范链接形态：为何带 `project_id`、确定不带 `version_id`

`buildDesignUrl` 拼出的链接是 `detailDetach?tid=&pid=&project_id=&image_id=` 四参。

- **带 `project_id`（与 `pid` 同值）**：URL 上的 `project_id` 是详情页 `project.id` 的**唯一初始来源**——只给 `pid` 时它开局为 `undefined`。蓝湖自己从 stage 跳详情页也是继承 stage 页全部 query 再追加 `project_id` + `image_id`，两参并存是宿主的常态；CLI 侧 `parseLanhuUrl` 按 `pid || project_id` 读取，两值相同不产生歧义。
- **确定不带 `version_id`**：蓝湖查看历史版本时**根本不写 URL**（三个版本组件内 `$route` / `pushState` 出现次数为 0），链接因此**无法编码"当时看的版本"**——任何 detailDetach 链接打开都是最新版，带上 `version_id` 也不会改变这一点。URL 里的 `version_id` 只服务于评论定位，须与 `comment_id` 成对出现，与设计稿定位无关。
