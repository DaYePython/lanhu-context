# @lanhu-context/ecosystem-core

## 0.1.0

### Minor Changes

- 922b15d: 新增 ecosystem-core 共享层与 lanhu-monkey 油猴脚本。
  
  - `@lanhu-context/ecosystem-core`（新包）：从 browser-extension 抽出的平台无关共享层——菜单注入框架与两页适配器、实测选择器、设计稿 URL 解析构建、Cookie 序列化、`auth listen` 桥接封装，以及 `installLanhuContextMenu` 共享编排（三项菜单的文案与行为唯一实现）。
  - `@lanhu-context/lanhu-monkey`（新包）：与浏览器扩展功能一致的油猴脚本（Tampermonkey / ScriptCat / Violentmonkey），单文件 `lanhu-monkey.user.js`。Cookie 经 `GM_cookie` 读取（开启管理器设置后含 HttpOnly），失败回落 `document.cookie` 并提示；「发送 cookies 到本机」经 `GM_xmlhttpRequest` 携带 `x-lanhu-bridge` 标记头。
  - `@lanhu-context/browser-extension`：内部重构为消费 ecosystem-core，行为不变。
