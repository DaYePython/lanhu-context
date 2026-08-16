# @lanhu-context/browser-extension

## 0.1.2

### Patch Changes

- dadd3b9: 修复扩展只能复制到一条 Cookie（`PASSPORT`）导致 `lanhu auth test` 失败：`host_permissions` 补上 `http://*.lanhuapp.com/*`。Chrome 按 Cookie 的 `Secure` 标志拼 URL 再匹配 host_permissions（Secure→https，非 Secure→http），蓝湖的 `user_token`/`session`/`SERVERID` 均非 Secure，只声明 https 时会被静默过滤。
  
  同时 content script 会把页面的 `document.cookie` 随消息交给 service worker，与 `chrome.cookies` 合并后再拼 Cookie 头，确保特权查询变窄时扩展也不会比页面本身能发出的 Cookie 更少。
- Updated dependencies [dadd3b9]
  - @lanhu-context/ecosystem-core@0.2.0

## 0.1.1

### Patch Changes

- 922b15d: 新增 ecosystem-core 共享层与 lanhu-monkey 油猴脚本。
  
  - `@lanhu-context/ecosystem-core`（新包）：从 browser-extension 抽出的平台无关共享层——菜单注入框架与两页适配器、实测选择器、设计稿 URL 解析构建、Cookie 序列化、`auth listen` 桥接封装，以及 `installLanhuContextMenu` 共享编排（三项菜单的文案与行为唯一实现）。
  - `@lanhu-context/lanhu-monkey`（新包）：与浏览器扩展功能一致的油猴脚本（Tampermonkey / ScriptCat / Violentmonkey），单文件 `lanhu-monkey.user.js`。Cookie 经 `GM_cookie` 读取（开启管理器设置后含 HttpOnly），失败回落 `document.cookie` 并提示；「发送 cookies 到本机」经 `GM_xmlhttpRequest` 携带 `x-lanhu-bridge` 标记头。
  - `@lanhu-context/browser-extension`：内部重构为消费 ecosystem-core，行为不变。
- Updated dependencies [922b15d]
  - @lanhu-context/ecosystem-core@0.1.0

## 0.1.0

### Minor Changes

- 3d2b3f3: 扩展纳入 changesets 发版：随发版打 tag 并创建 GitHub Release（不发 npm），CI 自动构建并附上 `lanhu-context-helper-<version>.crx` 与同名 `.zip`；`dist/manifest.json` 的版本号构建时从 package.json 注入。
