---
'@lanhu-context/cli': patch
---

`lanhu auth set` 交互体验优化与修复：

- 修复交互提示词被擦除的 bug：旧 `promptHidden` 基于 readline(terminal:true)，其内部刷新会发出 `ESC[1G ESC[0J` 把已打印的提示整行清掉，导致终端里"没有提示词"。改为 raw-mode stdin 手工隐藏输入（回车/Ctrl-D 提交、Ctrl-C 退出、退格可修正，不回显）。
- 交互前打印获取 Cookie 的分步引导 + 图文教程链接（https://lanhu.refineup.com/guide/get-lanhu-token）；已配置 token 时显示来源 + 掩码指纹并提示将覆盖。
- 读到输入后回显掩码指纹确认粘贴成功；空输入或不含 `=` 的输入交互式重试（最多 3 次）。
- 自动清洗粘贴杂质：`Cookie:` 前缀与包裹引号（stdin 模式同样生效）。
- TTY 下（无管道）传 `--token-stdin` / `--dds-token-stdin` 不再静默挂起，回落为交互隐藏输入，只提示对应 token。
