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
