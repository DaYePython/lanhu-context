# CLAUDE.md — @lanhu-context/lanhu-monkey

蓝湖两页（detailDetach / stage）右键菜单三项功能的**油猴脚本形态**，与 `../browser-extension` 功能一致；构建产物是单文件 `dist/lanhu-monkey.user.js`（vite-plugin-monkey）。私有包，不发布 npm，但**参与 changesets 发版**：发版打 tag `@lanhu-context/lanhu-monkey@x.y.z`，CI（`.github/workflows/release-userscript.yml`，由 release.yml 以 `workflow_call` 调用）把 `.user.js` 附到该 tag 的 GitHub Release，并**把产物回写到本目录的 `lanhu-monkey.user.js`**（GreasyFork 的 webhook 同步源，见下文「分发与更新」）。

## 与 ecosystem-core / browser-extension 的关系

**全部业务逻辑（菜单、文案、URL 解析构建、Cookie 序列化、桥接封装）在 [`../ecosystem-core`](../ecosystem-core/CLAUDE.md)**（`dependencies` 引入、构建时打进单文件）。本包只有两个源文件的职责：`src/gm-platform.ts` 实现 `MenuPlatform` 的三个 GM 适配器，`src/main.ts` 接线。一致性契约见 core 的 CLAUDE.md：**功能/文案变更改 core，双端（扩展 + 本包）rebuild 即同步；禁止在本包复制 core 已有逻辑**。改 core 后要重新 build 本包并重新安装 `.user.js` 才能生效。

## 常用命令

```bash
pnpm --filter @lanhu-context/lanhu-monkey dev        # vite dev：自动弹出 dev userscript 安装页，装一次后热更新
pnpm --filter @lanhu-context/lanhu-monkey build      # → dist/lanhu-monkey.user.js（版本号自动取 package.json）
pnpm --filter @lanhu-context/lanhu-monkey typecheck
pnpm vitest run ecosystem/lanhu-monkey               # 仅本包纯逻辑测试（doc-cookie）；注入/URL/桥接测试在 ecosystem-core
```

## 硬性约束（userscript 特有部分）

- **平台无关约束在 core**：选择器、菜单注入铁律、取值链等见 [`../ecosystem-core/CLAUDE.md`](../ecosystem-core/CLAUDE.md)。本包内不得出现 `chrome.*`。
- **`@grant` 不手写**：GM_* API 一律从 `'$'`（vite-plugin-monkey 的 client 别名）ESM 导入，插件按导入自动生成 `@grant` 头。新增 GM 能力=新增 import，`vite.config.ts` 不用动。
- **`@connect 127.0.0.1` 必须显式声明**（`vite.config.ts` 的 `userscript.connect`）：Tampermonkey 的 `@connect *` 不覆盖 localhost/IP；删掉它「发送 cookies 到本机」会静默要求用户逐次授权或直接失败。
- **发送通道靠 `x-lanhu-bridge` 请求头**，不是 Origin：GM_xmlhttpRequest 的 Origin 头不可控（默认带页面 Origin，改写需要用户开 Tampermonkey 危险设置），CLI 接收端（`packages/cli/src/io/bridge-server.ts` 的 `BRIDGE_MARKER_HEADER`）以该自定义头放行。**改头名两端必须同步**。安全论证在 bridge-server.ts 头注释（网页无法免 CORS preflight 携带自定义头）。
- **Cookie 采集是两级兜底链**（`src/gm-platform.ts`）：`GM_cookie.list`（TM 稳定版 ≥5.3.1 且用户开了 Security → Allow scripts to access cookies: All 时含 HttpOnly）→ 任何失败（API 缺失 / 未授权 / 空结果）回落 `document.cookie` 并在 toast 附加 HttpOnly 缺失提示（经 `CookieHeaderResult.note` 传给 core，本包不得自己弹 toast）。**不要移除兜底**：GM_cookie 在各管理器/版本间行为差异大，`lanhu auth test` 才是最终判据。
- **构建不 minify**（`vite.config.ts`）：处理凭据的 userscript 必须可读可审计，与扩展产物策略一致。
- **端口一致性**：`../ecosystem-core/src/constants.ts` 的 `DEFAULT_BRIDGE_PORT = 7623` 必须与 CLI `lanhu auth listen --port` 默认值一致，改一处必改另一处（`packages/cli/src/commands/auth.ts`）。
- **token 安全**（继承根 CLAUDE.md）：整段 Cookie 等同账号凭据。测试与文档一律用 `sid=FAKE` 类占位符；日志/toast 不回显 token 内容。

## 分发与更新（GreasyFork 同步）

- **`./lanhu-monkey.user.js`（本目录根，非 dist/）是 CI 覆写的发布物**：release-userscript.yml 在发版后把构建产物 commit 回该路径，GreasyFork 以其 raw URL 为同步源、靠仓库 push webhook（GitHub Settings → Webhooks，仅 push 事件；Settings 里的配置在仓库文件中不可见）感知更新。**不得手改该文件**（改了也会被下次发版覆写）；biome 已在 `biome.json` 里忽略它。
- **不用 `releases/latest/download/…` 当同步源**：changesets 给多个包打 tag，"latest" release 很少指向 userscript 那个，URL 会 404。这是选择回写方案的原因。
- **头部不配 `@updateURL`/`@downloadURL`**：GreasyFork 安装的更新走 GreasyFork；raw URL 直装的更新走管理器记住的安装来源。两条链都不需要这两个头，配了反而把 GreasyFork 用户的更新指到别处。
- GreasyFork 只在**版本号递增**时接受更新——版本由 changesets 管理，发版即满足；不发版只 push 不会触发脚本更新。
- 首次配置步骤（GreasyFork 侧 + GitHub webhook 侧）见 README「发布到 GreasyFork」。

## 已知限制（有意为之）

- **HttpOnly Cookie 依赖管理器设置**：这是 userscript 平台边界，不是 bug；完整保真走浏览器扩展（`chrome.cookies` 零配置含 HttpOnly）。
