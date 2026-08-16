# @lanhu-context/browser-extension
<img src="public/icons/icon48.png" width="48" height="48" alt="lanhu-context helper icon">


蓝湖浏览器扩展：在设计稿详情页（detailDetach）与项目画布页（stage）蓝湖自绘的右键菜单里注入三个菜单项，把登录态与设计稿定位信息一键喂给 `lanhu-context` CLI。私有包，不发布 npm。

## 安装

```bash
pnpm --filter @lanhu-context/browser-extension build
```

然后在 Chrome 中：

1. 打开 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择本目录下的 `dist/`

最低 Chrome 版本：**114**。

## 三个菜单项

在设计稿详情页（`https://lanhuapp.com/web/#/item/project/detailDetach?...`）或项目画布页（`.../#/item/project/stage?...`）**右键**，蓝湖菜单底部会出现三个菜单项（详情页带 `CLI` 徽标；stage 页沿用宿主菜单的朴素样式，无徽标）：

| 菜单项 | 作用 |
| --- | --- |
| 复制选中设计稿链接 | 解析 `tid`/`pid`/`image_id`，重构规范 URL（另带与 `pid` 同值的 `project_id`）写入剪贴板，可直接喂给 `lanhu context "<URL>"` |
| 复制 cookies | 通过 `chrome.cookies` 取 `lanhuapp.com` 全部 Cookie（**含 HttpOnly**，比 `document.cookie` 全）写入剪贴板，可粘贴给 `lanhu auth set` |
| 发送 cookies 到本机 | 把同一份 Cookie POST 到 `http://127.0.0.1:7623/token`，由 `lanhu auth listen` 一次性接收并写入用户级配置（0600） |

### 两个页面取设计稿 id 的方式不同

- **详情页（detailDetach）**：`image_id` 直接取自地址栏 hash。
- **画布页（stage）**：地址栏没有 `image_id`，扩展从左侧画板导航树的**选中项**反查。因此右键的必须是**一张设计图**——右键空白画布、分组或框选多张后再右键，「复制选中设计稿链接」会提示缺少 `image_id`，不产生错误链接；导航树被收起时同样不可用。
- 导航树节点上「⋯ 更多」按钮打开的是同一个右键菜单，三个菜单项在那里同样出现；对**分组**行点「复制选中设计稿链接」会提示缺少 `image_id`（分组不是设计图）。

## 与 `lanhu auth listen` 配合

```bash
# 终端：启动一次性接收端（默认 127.0.0.1:7623，120s 超时）
lanhu auth listen

# 浏览器：蓝湖设计稿页面 → 右键 → 「发送 cookies 到本机」
# 终端收到后自动写入用户级配置并退出；随后可验证：
lanhu auth status
lanhu auth test "<设计稿URL>"
```

接收端只接受 `Origin` 为 `chrome-extension://` 的请求，普通网页无法伪造该头；叠加仅监听回环地址、收到一次即退出、超时自动退出。

## 修改端口

端口在两处必须一致：

- 扩展侧：`src/shared/constants.ts` 的 `DEFAULT_BRIDGE_PORT`（改后重新 build 并在 `chrome://extensions` 点刷新）
- CLI 侧：`lanhu auth listen --port <port>`

## 权限说明

- `permissions`: `cookies`（读取 lanhuapp.com Cookie，含 HttpOnly——这正是做成扩展而非油猴脚本的原因）、`clipboardWrite`
- `host_permissions`: 仅 `https://*.lanhuapp.com/*` 与 `http://127.0.0.1/*`，不触达其他站点

## 安全提示

**整段 Cookie 等同蓝湖账号凭据。** 勿分享、勿提交到仓库、勿粘贴到不可信的地方；CLI 侧输出只显示掩码指纹，绝不回显明文。

## 已知限制

- **多选不复制链接**：框选多张设计图后右键，"哪一张"无从判断，「复制选中设计稿链接」只会提示缺少 `image_id`。
- **折叠分组依赖宿主自动展开**：右键折叠分组内的设计图时，靠蓝湖自动展开其祖先分组、把选中态同步到导航树；若宿主该行为改变，反查会退化为提示缺少 `image_id`。
- **二级菜单展开会让定位修正失效**：stage 页注入后扩展会把超出视口底部的菜单上移一次；hover「移动至分组」等带二级菜单的宿主项时，蓝湖会重写菜单的内联样式，上移随之被还原。

## 蓝湖改版导致菜单项消失时

注入依赖实测选择器（详情页 `src/content/selectors.ts`、画布页 `src/content/stage-selectors.ts`，实测记录见 [docs/NOTES.md](docs/NOTES.md)）。若蓝湖前端改版导致选择器失效，注入会静默失败（不报错）；按 [docs/implementation-plan.md](docs/implementation-plan.md)（详情页）或 [docs/implementation-plan-stage-menu.md](docs/implementation-plan-stage-menu.md)（画布页）Task 1 折叠区的侦察/验证方法留档重测并更新对应选择器文件即可，业务逻辑无需改动。
