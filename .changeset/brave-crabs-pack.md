---
'@lanhu-context/browser-extension': minor
---

扩展纳入 changesets 发版：随发版打 tag 并创建 GitHub Release（不发 npm），CI 自动构建并附上 `lanhu-context-helper-<version>.crx` 与同名 `.zip`；`dist/manifest.json` 的版本号构建时从 package.json 注入。
