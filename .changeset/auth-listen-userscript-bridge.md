---
'@lanhu-context/cli': minor
---

`lanhu auth listen` 新增油猴脚本放行通道：除 `Origin: chrome-extension://`（浏览器扩展）外，携带非空 `x-lanhu-bridge` 请求头的请求也被接受（配套 `ecosystem/lanhu-monkey`）。安全模型不变——网页无法伪造扩展 Origin，也无法在不触发 CORS preflight 的情况下携带自定义头，preflight 不会放行。监听提示与超时文案相应更新为「浏览器扩展 / 油猴脚本」。
