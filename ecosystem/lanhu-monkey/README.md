# @lanhu-context/lanhu-monkey

<img src="../browser-extension/public/icons/icon48.png" width="48" height="48" alt="lanhu-context helper icon">

蓝湖油猴脚本（userscript）：在设计稿详情页（detailDetach）与项目画布页（stage）蓝湖自绘的右键菜单里注入三个菜单项，把登录态与设计稿定位信息一键喂给 `lanhu-context` CLI。功能与 [`../browser-extension`](../browser-extension/README.md) 浏览器扩展**一致**（同一份共享实现 [`../ecosystem-core`](../ecosystem-core)），面向不方便装扩展、但装了脚本管理器的场景。私有包，不发布 npm；随仓库 changesets 发版，产物（`.user.js`）见 GitHub Releases。

## 安装

需要脚本管理器：**Tampermonkey**（推荐，≥5.3.1）/ ScriptCat / Violentmonkey（Cookie 能力见下文差异表）。

### 方式一：GreasyFork（推荐，自动更新）

装好脚本管理器后，打开脚本主页[「蓝湖 lanhu-context 助手」](https://greasyfork.org/scripts/591618)点「安装此脚本」，或直接点[一键安装链接](https://update.greasyfork.org/scripts/591618/%E8%93%9D%E6%B9%96%20lanhu-context%20%E5%8A%A9%E6%89%8B.user.js)由脚本管理器弹出安装确认。GreasyFork 与本仓库 webhook 同步，发版后自动推送更新。

### 方式二：GitHub raw 直装（自动更新）

直接打开下面的地址，脚本管理器会弹出安装确认；之后管理器按安装来源检查更新：

```
https://github.com/DaYePython/lanhu-context/raw/main/ecosystem/lanhu-monkey/lanhu-monkey.user.js
```

### 方式三：从 GitHub Release 下载（无自动更新）

到 [Releases](https://github.com/DaYePython/lanhu-context/releases) 页找最新的 `@lanhu-context/lanhu-monkey@x.y.z`，下载附件 `lanhu-monkey.user.js` 拖进浏览器安装。Release 附件 URL 随版本变化，升级需重新下载。

### 方式四：从源码构建

```bash
pnpm --filter @lanhu-context/lanhu-monkey build
```

产物在 `dist/lanhu-monkey.user.js`，安装方式同上。开发调试用 `pnpm --filter @lanhu-context/lanhu-monkey dev`：vite-plugin-monkey 会自动打开 dev userscript 的安装页，装一次后改代码即热更新。

## 三个菜单项

在设计稿详情页（`https://lanhuapp.com/web/#/item/project/detailDetach?...`）或项目画布页（`.../#/item/project/stage?...`）**右键**，蓝湖菜单底部会出现三个菜单项（详情页带 `CLI` 徽标；stage 页沿用宿主菜单的朴素样式，无徽标）：

| 菜单项 | 作用 |
| --- | --- |
| 复制选中设计稿链接 | 解析 `tid`/`pid`/`image_id`，重构规范 URL（另带与 `pid` 同值的 `project_id`）写入剪贴板，可直接喂给 `lanhu context "<URL>"` |
| 复制 cookies | 优先经 `GM_cookie` 取 `lanhuapp.com` Cookie（开启相应设置后**含 HttpOnly**），失败时回落 `document.cookie`（无 HttpOnly，toast 会提示），写入剪贴板，可粘贴给 `lanhu auth set` |
| 发送 cookies 到本机 | 把同一份 Cookie 经 `GM_xmlhttpRequest` POST 到 `http://127.0.0.1:7623/token`（携带 `x-lanhu-bridge` 标记头），由 `lanhu auth listen` 一次性接收并写入用户级配置（0600） |

两个页面取设计稿 id 的方式与扩展完全一致（详情页取地址栏、画布页从左侧导航树选中项反查；空白区/分组/多选会提示缺少 `image_id`），详见扩展 README 的[对应小节](../browser-extension/README.md#两个页面取设计稿-id-的方式不同)。

## 读取 HttpOnly Cookie（Tampermonkey 设置）

蓝湖的登录 Cookie 含 HttpOnly 项，`document.cookie` 拿不到。要让脚本取到完整 Cookie：

1. Tampermonkey 图标 → 管理面板 → 设置，「配置模式」选 **高级（Advanced）**；
2. 找到 **Security → Allow scripts to access cookies**，选 **All**（Tampermonkey 稳定版 ≥5.3.1 支持）；
3. 重新执行菜单项。若 toast 仍提示未含 HttpOnly，用 `lanhu auth test "<设计稿URL>"` 验证 token 是否够用，不够用就改装浏览器扩展。

ScriptCat 支持 `GM_cookie`（安装脚本时确认 Cookie 权限即可）；Violentmonkey 需在设置里显式允许。

## 与浏览器扩展的差异

| | 浏览器扩展 | 油猴脚本（本包） |
| --- | --- | --- |
| Cookie 完整性 | `chrome.cookies`，**零配置含 HttpOnly** | `GM_cookie` 需手动开设置；未开启回落 `document.cookie`（缺 HttpOnly） |
| 安装方式 | 加载解压目录 / 企业分发 crx | 单文件 `.user.js`，任何脚本管理器 |
| 发送到本机的通道校验 | `Origin: chrome-extension://` | `x-lanhu-bridge` 请求头 |
| 菜单注入 / 链接解析 | 同一份 `ecosystem-core` 实现，行为一致 | 同左 |

拿不准选哪个：能装扩展就装扩展（Cookie 保真度零配置）；只临时登录一次，油猴脚本 + `lanhu auth test` 验证也够用。

## 与 `lanhu auth listen` 配合

```bash
# 终端：启动一次性接收端（默认 127.0.0.1:7623，120s 超时）
lanhu auth listen
# 尚未安装 CLI 时，用 npx 免安装登录：
npx -y -p @lanhu-context/cli lanhu auth listen

# 浏览器：蓝湖设计稿页面 → 右键 → 「发送 cookies 到本机」
# 终端收到后自动写入用户级配置并退出；随后可验证：
lanhu auth status
lanhu auth test "<设计稿URL>"
```

接收端只接受浏览器扩展来源（`Origin: chrome-extension://`）或油猴脚本标记（`x-lanhu-bridge` 请求头）的请求，普通网页两者都无法伪造；叠加仅监听回环地址、收到一次即退出、超时自动退出。

## 修改端口

端口在两处必须一致：

- 脚本侧：`../ecosystem-core/src/constants.ts` 的 `DEFAULT_BRIDGE_PORT`（改后重新 build 并重新安装 `.user.js`）
- CLI 侧：`lanhu auth listen --port <port>`

## 权限说明（userscript 头部）

- `@grant GM_cookie`：读取 lanhuapp.com Cookie（含 HttpOnly，需开设置）——这是「复制/发送 cookies」的数据来源
- `@grant GM_setClipboard`：写剪贴板（失败时回落 DOM 复制）
- `@grant GM_xmlhttpRequest` + `@connect 127.0.0.1`：仅用于把 Cookie POST 给本机 `lanhu auth listen`，不触达其他地址
- `@match https://lanhuapp.com/web/*`：只在蓝湖页面运行

## 安全提示

**整段 Cookie 等同蓝湖账号凭据。** 勿分享、勿提交到仓库、勿粘贴到不可信的地方；CLI 侧输出只显示掩码指纹，绝不回显明文。

## 已知限制

- **Cookie 完整性依赖管理器设置**（见上文）；`lanhu auth test` 是最终判据。
- 扩展 README 列出的宿主行为限制（多选不复制链接、折叠分组依赖宿主自动展开、二级菜单展开还原定位修正）同样适用。

## 发布到 GreasyFork（维护者一次性配置）

分发链路：CI 在每次 `@lanhu-context/lanhu-monkey` 发版后，把构建产物回写到本目录的 `lanhu-monkey.user.js`（见 `.github/workflows/release-userscript.yml`），GreasyFork 通过 push webhook 感知并从 raw URL 拉取更新（版本号由 changesets 递增，满足 GreasyFork 的更新要求）。首次配置两步：

1. **GreasyFork 侧**：发布脚本时选「从 URL 同步」，同步 URL 填：

   ```
   https://github.com/DaYePython/lanhu-context/raw/main/ecosystem/lanhu-monkey/lanhu-monkey.user.js
   ```

   同步方式选 **Webhook**，记下 GreasyFork 给出的 Payload URL 与 Secret。

2. **GitHub 侧**：仓库 Settings → Webhooks → Add webhook——Payload URL 填 GreasyFork 给的地址（形如 `https://api.greasyfork.org/zh-CN/users/<id>/webhook`）；Content type 选 `application/json`；Secret 填 GreasyFork 显示的值；事件选 **Just the push event**；勾选 Active。

之后无需人工干预：merge 版本 PR → CI 发版并回写产物 → webhook 触发 GreasyFork 更新。

## 蓝湖改版导致菜单项消失时

注入依赖实测选择器，唯一依据在 [`../ecosystem-core/src/menu/`](../ecosystem-core/src/menu/)（`detail-selectors.ts` / `stage-selectors.ts`）；重测流程见扩展的 [docs/implementation-plan.md](../browser-extension/docs/implementation-plan.md) 与 [docs/implementation-plan-stage-menu.md](../browser-extension/docs/implementation-plan-stage-menu.md)。更新选择器后重新 build 本包与扩展即可，业务逻辑无需改动。
