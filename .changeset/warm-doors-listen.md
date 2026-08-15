---
'@lanhu-context/cli': minor
---

新增 `lanhu auth listen`：从浏览器扩展一次性接收蓝湖 Cookie 并写入用户级配置（0600）。仅监听 127.0.0.1，只接受 `chrome-extension://` 来源，收到一次或超时后退出；超时 → exit 3（TOKEN_MISSING），端口被占用 → exit 7（IO_WRITE_FAILED），`--port`/`--timeout` 非法 → exit 2（USAGE_ERROR）。
