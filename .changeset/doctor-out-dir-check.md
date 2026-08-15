---
'@lanhu-context/cli': minor
'@lanhu-context/core': patch
---

`lanhu doctor` 新增 `--out-dir <path>`：输出目录检查改为探测用户实际要用的目录（缺省仍检查默认的 `<cwd>/.lanhu.local`），已存在的目录检查可写、不存在的目录验证可创建（探测后自动清理）。

core：`meta` 的 `projectName` 在 `/api/project/image` 响应缺失 `project_name` 时，轻量回退到项目列表（`multi_info`，`img_limit=1`）顶层 `name` 补齐；回退失败只会让 `projectName` 缺省，不影响 `meta` 本身成功。
