# @lanhu-context/browser-extension

蓝湖设计稿详情页（detailDetach）浏览器扩展：在蓝湖自绘的右键菜单里注入三个菜单项，把登录态与设计稿定位信息一键喂给 `lanhu-context` CLI。私有包，不发布 npm。

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

在 `https://lanhuapp.com/web/#/item/project/detailDetach?...` 设计稿页面**右键**，蓝湖菜单底部会出现（带 `CLI` 徽标）：

| 菜单项 | 作用 |
| --- | --- |
| 复制选中设计稿链接 | 从地址栏 hash 解析 `tid`/`pid`/`image_id`，重构规范三参数 URL 写入剪贴板，可直接喂给 `lanhu context "<URL>"` |
| 复制 cookies | 通过 `chrome.cookies` 取 `lanhuapp.com` 全部 Cookie（**含 HttpOnly**，比 `document.cookie` 全）写入剪贴板，可粘贴给 `lanhu auth set` |
| 发送 cookies 到本机 | 把同一份 Cookie POST 到 `http://127.0.0.1:7623/token`，由 `lanhu auth listen` 一次性接收并写入用户级配置（0600） |

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

## 蓝湖改版导致菜单项消失时

注入依赖实测选择器（`src/content/selectors.ts`，实测记录见 [NOTES.md](NOTES.md)）。若蓝湖前端改版导致选择器失效，注入会静默失败（不报错）；按仓库 `plan.md` Task 1 折叠区的「侦察方法留档」重测并更新 `selectors.ts` 即可，业务逻辑无需改动。
