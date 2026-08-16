---
'@lanhu-context/ecosystem-core': minor
'@lanhu-context/lanhu-monkey': patch
---

新增 `mergeCookies`，`collectCookieHeader` 接受可选的页面 Cookie 列表：特权 Cookie 源（`chrome.cookies` / `GM_cookie`）与页面 `document.cookie` 合并，同名以特权源为准。`parseDocumentCookie` 从 lanhu-monkey 迁入 core，两端共用同一实现。
