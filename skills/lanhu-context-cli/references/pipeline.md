# pipeline：管道配方集

以下每条配方均在本仓库对真实设计稿（`首页-数据大屏`，45 张切图）实测通过；`$URL` 为完整 lanhuapp.com 设计稿 URL。未安装时 `lanhu` = `npx -y -p @lanhu-context/cli lanhu`。

## 1. schema 落盘 → `html -` 离线转换

何时用：同一张稿要反复调 `--tailwind`/`--unit-scale` 等转换参数，只想请求蓝湖一次。

```bash
lanhu schema "$URL" > page.schema.json
lanhu html - --tailwind --tw-version 4 < page.schema.json > page.html
```

实测：schema 99530 bytes（`{"style":{"backgroundColor":"rgba(255,255,255,1.000000)","zIndex":1,…`），两步均 exit 0；离线转换不发任何网络请求，产出 42693 bytes Tailwind HTML：

```html
class="bg-white relative w-[750px] h-[2056px] overflow-hidden flex flex-col"
```

## 2. `parse | jq` 只取 ID

何时用：给别的脚本/接口传 teamId/projectId/imageId，不需要任何产物。

```bash
lanhu parse "$URL" --json | jq -r .data.imageId
```

实测输出（exit 0）：

```text
a1b2c3d4-2cec-4ede-acf5-3b3615f5cd96
```

## 3. `tokens --format css` 重定向成变量文件

何时用：把设计稿视觉 token 固化为项目 CSS 变量（或与现有变量 diff）。

```bash
lanhu tokens "$URL" --format css > src/styles/design-tokens.css
```

实测：本测试稿无高风险 token——stdout `:root {}`、stderr `WARN TOKENS_UNAVAILABLE: No high-risk design tokens found in this design (empty result)`、exit 0（附属内容缺失不算失败）。重定向文件只含产物，warning 不会混进去；`--strict` 时 exit 8。

## 4. `assets --download` 重复执行安全的下载

何时用：把切图落到**最终交付目录**（不是 `.lanhu.local`——那里只放 context/preview/schema 等中间产物）。交付目录由你按项目结构决定，推荐 `src/assets/<语义化页面名>`；可反复执行（已存在且内容相同的文件自动跳过，等价增量/续传）。

```bash
lanhu assets "$URL" --download -o src/assets/<语义化页面名> --concurrency 4 --json
```

实测 `data.summary`：首跑 `{"total":45,"written":45,"skipped":0,"overwritten":0,"failed":0}`；紧接着重跑 `{"total":45,"written":0,"skipped":45,"overwritten":0,"failed":0}`（内容一致全部 skipped），两次均 exit 0。先看清单不写盘：`--download --dry-run --json | jq .data.items`（实测每条 `"status":"planned"`，无 summary，exit 0）。

## 5. `context --inline` 接下游 AI

何时用：不落盘，把完整实现上下文直接塞给下游 AI CLI 的 prompt。

```bash
lanhu context "$URL" --inline | claude -p "按 context 实现这个页面"
```

实测（`--inline | wc -c`）：stdout 76011 bytes context 正文（HTML+CSS → 45 条切图映射 → 实现指引），exit 0；摘要走 stderr、不污染管道：

```text
ℹ design: 首页-数据大屏 (a1b2c3d4)
ℹ context: 76010 bytes inline; assets mapping: 45
```

注意：`--inline` 与 `--json` 互斥（exit 2 `USAGE_ERROR`）。

## 6. `preview` 双通道

何时用：要预览图文件（读报告决定后续动作）或直接把 PNG 流给下游。

```bash
lanhu preview "$URL" -o preview.png --json | jq .data.status   # "written"；重跑 → "skipped"
lanhu preview "$URL" -o - > preview.png                        # 二进制直出，无 envelope，状态看退出码
```

实测：首跑 `{"path":"…/preview.png","bytes":439128,"status":"written"}`，重跑 `"status":"skipped"`（重复执行安全）；`-o -` 直出 439128 bytes（`file` 验证 `PNG image data, 750 x 2056`），stderr `ℹ preview: 439128 bytes -> stdout`——三次均 exit 0。`--json -o -` 是用法错误（exit 2）。
