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

## 4. URL 跟随设计稿切换

**结论：跟随。** 切换设计稿后 `location.hash` 中的 `image_id` 随之改变。

因此「复制选中设计稿链接」只需从 `location.hash` 解析 `tid` / `pid` / `image_id`，无需读取页面任何 JS 全局变量，content script 也不需要 `world: "MAIN"`。

## 5. 与计划中「逆向结论摘要」的差异

| 项 | 计划推断 | 实测 | 处理 |
| --- | --- | --- | --- |
| 列表容器 | `.mu-menu` | `.mu-menu-list` | 以实测为准 |
| 菜单项结构 | `.mu-menu-item` 直接包 `span.menu-item-title` | 5 层嵌套，中间有 `.mu-menu-item-title` | 以实测为准，`buildMenuItem` 按真实层级构造 |
| 徽标位置 | 未预见 | `.key-icon > .hotkey`，可选 | 新增 `MenuItemSpec.badge` 可选字段 |
| 原生右键菜单被屏蔽 | 是 | 是 | 一致 |
| URL 跟随切换 | 假定跟随 | 跟随 | 一致 |
