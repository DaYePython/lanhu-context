---
'@lanhu-context/browser-extension': patch
---

修复扩展只能复制到一条 Cookie（`PASSPORT`）导致 `lanhu auth test` 失败：`host_permissions` 补上 `http://*.lanhuapp.com/*`。Chrome 按 Cookie 的 `Secure` 标志拼 URL 再匹配 host_permissions（Secure→https，非 Secure→http），蓝湖的 `user_token`/`session`/`SERVERID` 均非 Secure，只声明 https 时会被静默过滤。

同时 content script 会把页面的 `document.cookie` 随消息交给 service worker，与 `chrome.cookies` 合并后再拼 Cookie 头，确保特权查询变窄时扩展也不会比页面本身能发出的 Cookie 更少。
