# 蓝湖浏览器扩展（lanhu-context ecosystem）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐个实施。步骤使用 `- [ ]` 复选框语法便于跟踪。

**Goal:** 在 lanhuapp.com 设计稿详情页（detailDetach）的右键菜单中注入「复制选中设计稿链接」「复制 cookies」「发送 cookies 到本机」三项，把蓝湖登录态与设计稿定位信息一键喂给 `lanhu-context` CLI。

**Architecture:** 新建 `ecosystem/` monorepo 子目录，放置 MV3 浏览器扩展（Vite + TypeScript）。扩展只有两层：content script（ISOLATED world）把菜单项注入蓝湖自己的 Vue popover 菜单——蓝湖 `preventDefault` 了原生右键菜单，`chrome.contextMenus` 在画布区不会出现——并从 `location.hash` 解析设计稿参数、负责剪贴板写入；service worker 用 `chrome.cookies` 取完整 Cookie（含 HttpOnly）并 POST 到本机。CLI 侧新增 `lanhu auth listen`，在 127.0.0.1 上一次性接收并写入用户级配置。

**Tech Stack:** Vite 7 + TypeScript 5、Chrome MV3、vitest（jsdom 用于 DOM 测试）、pnpm workspace、citty（CLI）、node:http（本机接收端）。

---

## ⛔ 实施阶段禁止事项

**实施本计划时不得打开、读取、grep `lhcdn.lanhuapp.com.local/` 下的任何文件。** 该目录是蓝湖前端 bundle 的本地镜像与反混淆产物，仅供计划阶段调研使用。本计划所需的全部逆向结论已固化在下方「逆向结论摘要」一节；除此之外的页面事实一律通过 Task 1 在**真实浏览器**中实测获得，不得回头翻源码。

若实测结果与「逆向结论摘要」冲突，**以实测为准**，并把差异记录进 `NOTES.md`。

---

## Global Constraints

以下约束来自 `CLAUDE.md` 与 `DESIGN.md`，**每个任务的验收标准都隐含包含本节**：

- **token 安全**：`LANHU_TOKEN` 是整段浏览器 Cookie。绝不回显、绝不写入日志/测试快照/提交。测试与文档中的 Cookie 一律用占位符（如 `sid=FAKE; uid=FAKE`）。CLI 输出只允许出现 `maskSecret()` 掩码指纹。
- **stdout 纪律**：CLI 命令 stdout 只放数据（`--json` 时是统一 envelope），日志/进度/提示一律走 stderr。
- **错误模型**：三级严重性 fatal / degraded / notice + 分类退出码（`packages/cli/src/exit.ts`）。`LanhuErrorCode` 是**闭合联合类型**，不得新增错误码——只能复用既有码。
- **本计划用到的既有错误码**：`USAGE_ERROR`(exit 2)、`CONFIG_INVALID`(exit 3)、`TOKEN_MISSING`(exit 3)、`IO_WRITE_FAILED`(exit 7)。
- **package manager**：pnpm 10；Node `^20.19.0 || >=22.12.0`。
- **代码风格**：biome（`pnpm lint`）。沿用既有文件风格：英文技术注释 + 中文用户可见文案。
- **样式**：扩展不自带 CSS。注入的菜单项复用蓝湖菜单已有的 class，让它自然继承宿主样式；不追求像素级对齐。
- **skills 同步**：命令、flag、退出码、envelope 字段的任何变更，必须同步 `skills/*/SKILL.md` 与 `skills/lanhu-context-cli/references/`。
- **发布**：用 changesets（`pnpm changeset`），不要手改版本号。
- **端口一致性**：`DEFAULT_BRIDGE_PORT = 7623`，扩展常量与 CLI `--port` 默认值必须一致。

---

## 逆向结论摘要（计划阶段已完成，实施时不必也不得复查源码）

### A. 蓝湖屏蔽了原生右键菜单 → 必须注入 DOM

设计稿详情页在容器 `#detail_container` 上绑定了 Vue 的 `@contextmenu` 处理器，并在多处执行 `document.oncontextmenu = e => e.preventDefault()` / `window.oncontextmenu = e => e.preventDefault()`。

**结论：`chrome.contextMenus` 注册的菜单项在画布区不会弹出。** 三个菜单项必须以 DOM 形式注入蓝湖自绘的菜单。**已于 Task 1 真机复核确认。**

### B. 蓝湖菜单的结构与行为

蓝湖右键菜单由一个 Vue 组件渲染，使用 muse-ui 的 popover + menu。**完整实测结构见 `ecosystem/browser-extension/docs/NOTES.md`，常量已固化在 `src/content/selectors.ts`。**

行为特征（来自源码调研）：

- popover 本身绑定了 `@mouseup.stop`
- 组件在 mounted 时监听事件总线的 `contextMenuMouseUpEvent`，**收到后会关闭菜单**
- 页面还有一处逻辑：`mouseup` 时若 `event.which === 3` 则触发 contextmenu
- 宿主原生菜单项：「选中图层」（条件显示，带子菜单）、「返回」、「重新加载」、「下载图片」（条件显示）

**对实现的三个硬性影响：**

1. 菜单每次右键都是**新建再销毁**的，注入器必须用 `MutationObserver` 持续观察，不能只跑一次。
2. 注入项必须 `stopPropagation()` 掉 `mouseup`，否则菜单会在 `click` 触发前就被宿主关掉，导致点击无效。
3. 列表容器是 **`.mu-menu-list`**（不是 `.mu-menu`），且每个菜单项是 **5 层嵌套**、标题不在 `.mu-menu-item` 的直接子级。扁平近似会渲染成无样式的裸文本。

### C. 设计稿 URL 格式 —— ⚠ `tid` 会在切换设计稿时从 URL 中消失

蓝湖走 hash 路由，进入页面时的完整形态：

```
https://lanhuapp.com/web/#/item/project/detailDetach?tid=<团队>&pid=<项目>&image_id=<设计稿>
```

参数别名规则（与 `packages/core/src/url/parse.ts` 一致）：`pid` | `project_id`，`image_id` | `docId`。`parseLanhuUrl` 按 `&` 切分后只读取白名单键，**未知参数被安全忽略**。

**但 URL 并不稳定。** `design-detail/components/MarkLeft.vue:609-617` 在用户切换设计稿时整段替换 query：

```js
changeUrlQuery: function (t, e) {
  if (t.id !== this.$route.query.image_id) {
    var n = e || { pid: this.projectId, project_id: this.projectId, image_id: t.id };
    // …$router.push({ name: "detailDetach", query: n })
  }
}
```

新 query 只有 `{ pid, project_id, image_id }`——**`tid` 被整个丢掉**。所以「初次进入页面 URL 带 tid，切一次设计稿后就没有了」，只读 URL 的解析器会在最常见的使用路径上失败。

**蓝湖自己的解法**是一条 fallback 链，在 `getTeamId()` 中反复出现（`project-entry/api/msg-center-server.js:407`、`editor/components/ItemProjectEditor.vue:2047` 等多处）：

```js
getTeamId: function () {
  return this.$route.query.team_id || this.$route.query.tid || this.team_id || localStorage.team_id;
}
```

`project_id` 同样有兜底（`design-detail/api/project-sign-url.js:163`）：`project_id: i || localStorage.pid`。

**localStorage 兜底键**（`team_id` 全仓 119 次引用，`pid` 55 次）：

| 字段 | URL 键（按优先级） | localStorage 兜底 | 写入点 |
| --- | --- | --- | --- |
| teamId | `tid` → `team_id` | `team_id` | `main/utils/auth.js:41`、`common/api/account-userinfo.js:288` 等 |
| projectId | `pid` → `project_id` | `pid` | `main/utils/auth.js:42`、`design-detail/api/zvn-item.js:609` |
| imageId | `image_id` → `docId` | **无兜底（刻意）** | —— |

`image_id` **不做** localStorage 兜底：`changeUrlQuery` 保证它始终在 URL 里，而一个过期的存储值会导致静默复制到错误的设计稿——宁可失败也不能复制错。

**⚠ 存储值可能是垃圾。** `common/utils/tip-team.js:72` 会写入字面量字符串 `"undefined"`（`localStorage.team_id = "undefined"`），`item/api/account-project.js:589` 会写入空串（`localStorage.pid = ""`）。取值时必须把 `''` / `'undefined'` / `'null'` 一律视为缺失。

**结论：解析需要 URL + localStorage 两个来源。** content script 运行在 ISOLATED world 时与页面**同源**，因此可以直接读同一份 `localStorage`——这条修正**不需要**引入 `world: "MAIN"`，也不需要 MAIN↔ISOLATED 消息通道。

### D. CLI 侧现状（可直接查阅 `packages/`，不受禁令限制）

- `packages/cli/src/commands/auth.ts` 已有 `set` / `status` / `test` 三个子命令，通过文件末尾的 `subCommands` 挂载
- `writeUserConfig(path, patch)`（`packages/cli/src/config/user-config.ts`）以 0600 写入用户级配置
- `ctx.config.userConfigPath` 提供该路径
- handler 返回 `{ data, render, summary }`
- `maskSecret(token)`（`packages/cli/src/config/index.ts`）产出掩码指纹
- 既有代码用 `new LanhuError(code, message, { hint })` 传提示

---

## File Structure

**新建 `ecosystem/browser-extension/`**（私有包，不发布 npm）：

| 文件 | 职责 |
| --- | --- |
| `package.json` | 私有包声明、构建脚本、devDeps |
| `tsconfig.json` | TS 配置，含 `chrome-types` |
| `vite.config.ts` | 共享 Vite 基础配置 |
| `scripts/build.ts` | 驱动两次 Vite 构建（SW 用 ES、content script 用 IIFE） |
| `public/manifest.json` | MV3 manifest |
| `docs/NOTES.md` | ✅ 已存在：真机侦察记录（含菜单项 outerHTML） |
| `src/shared/constants.ts` | `DEFAULT_BRIDGE_PORT` 等常量 |
| `src/shared/url.ts` | `parseHashParams` / `resolveDesignRef` / `buildDesignUrl`（纯函数） |
| `src/shared/cookies.ts` | `sortCookies` / `formatCookieHeader`（纯函数） |
| `src/shared/protocol.ts` | content ↔ service worker 消息类型 |
| `src/content/selectors.ts` | ✅ 已存在：实测填入的菜单选择器与 class 常量 |
| `src/content/menu.ts` | `buildMenuItem` / `injectInto` / `installMenuInjector` |
| `src/content/clipboard.ts` | `copyText`（clipboard API + execCommand 兜底） |
| `src/content/index.ts` | content script 入口：菜单接线 + 三个动作 |
| `src/background/collect.ts` | `collectCookieHeader` / `sendCookieHeader`（可注入依赖） |
| `src/background/index.ts` | service worker：消息路由 |

**修改既有文件**：

| 文件 | 改动 |
| --- | --- |
| `pnpm-workspace.yaml` | 新增 `ecosystem/*` |
| `vitest.config.ts` | include 新增 `ecosystem/*/src/**/__tests__/**/*.spec.ts` |
| `packages/cli/src/io/bridge-server.ts` | **新建**：本机一次性接收端 |
| `packages/cli/src/commands/auth.ts` | 新增 `listen` 子命令并挂载 |
| `skills/lanhu-context-cli/SKILL.md` + `references/` | 同步 `auth listen` |
| `README.md` | 扩展安装与使用说明 |

---

### Task 1: 真机侦察，产出选择器常量 ✅ 已完成

**本任务已在计划阶段完成，实施时跳过。** 侦察在真实页面上执行完毕，两份产物已存在于仓库：

- `ecosystem/browser-extension/docs/NOTES.md` —— 完整实测记录（含菜单项 outerHTML）
- `ecosystem/browser-extension/src/content/selectors.ts` —— 后续所有 DOM 代码的唯一依据

**Interfaces（已产出，Task 6 直接消费）：**

```ts
DIALOG_SELECTOR = '.detail_context_menu_dialog'
LIST_SELECTOR   = '.mu-menu-list'
ITEM_SELECTOR   = '.mu-menu-item'
WRAPPER_CLASS   = 'mu-menu-item-wrapper'
RIPPLE_CLASS    = 'mu-ripple-wrapper'
ITEM_CLASS      = 'mu-menu-item'
TITLE_BOX_CLASS = 'mu-menu-item-title'
TITLE_CLASS     = 'menu-item-title'
BADGE_BOX_CLASS = 'key-icon'
BADGE_CLASS     = 'hotkey'
WRAPPER_STYLE   = 'user-select: none; outline: none; cursor: pointer; appearance: none;'
```

**实测要点（三条会咬人的）：**

1. **列表容器是 `.mu-menu-list`，不是 `.mu-menu`。** 层级为 `.detail_context_menu_dialog > .mu-menu > .mu-menu-list > <每一项>`。往 `.mu-menu` 上 append 会让节点落在列表外。
2. **菜单项是 5 层嵌套，标题不是 `.mu-menu-item` 的直接子节点。** 真实结构（宿主原生「返回」项）：

```html
<div>
  <div class="mu-menu-item-wrapper" tabindex="0"
       style="user-select: none; outline: none; cursor: pointer; appearance: none;">
    <div class="">
      <div class="mu-ripple-wrapper"></div>
      <div class="mu-menu-item">
        <div class="mu-menu-item-title"><span class="menu-item-title">返回</span></div>
        <div><span class="key-icon"><span class="hotkey">esc</span></span></div>
      </div>
    </div>
  </div>
</div>
```

3. **现场已存在第三方注入器。** 实测时菜单里已有 `data-lanhu-helper-copy-link` / `data-lanhu-example-prompt` / `data-lanhu-helper-settings` 三项（标题分别为「复制选中图层链接」「复制示例提示词」「设置提示词模板」，带 `⚡MCP` 徽标）。两点影响：
   - 本扩展的标记一律用 `data-lanhu-ext-*` 前缀，避免命名冲突；
   - 该工具的「复制选中图层链接」与本扩展的「复制选中设计稿链接」职能相近，同时启用会出现两个相似条目。**本扩展不检测、不移除他人注入的节点**；是否停用其一由产品侧决定。
   - 附带好处：它证明了往 `.mu-menu-list` 追加节点可行，宿主不会清理外来子节点。

**其余两项复核结论：** 原生右键菜单确认被屏蔽（`chrome.contextMenus` 不可用，必须 DOM 注入）；`location.hash` 的 `image_id` 确认跟随设计稿切换，**但 `tid` 会在切换时被丢弃**——详见逆向结论 C，取值需 URL + localStorage 两级 fallback。

<details>
<summary>侦察方法留档（仅在蓝湖改版导致注入失效时需要重跑）</summary>

- [ ] **复核原生右键菜单**

在 Chrome 中打开任意 `https://lanhuapp.com/web/#/item/project/detailDetach?tid=...&pid=...&image_id=...` 页面，确认已登录且设计稿已渲染。在画布区域右键，观察弹出的是 Chrome 原生菜单还是蓝湖自绘菜单。然后在 Console 执行：

```js
console.log('document.oncontextmenu =', document.oncontextmenu);
console.log('window.oncontextmenu =', window.oncontextmenu);
```

至少一个不为 `null`，且画布区右键**不出现** Chrome 原生菜单，即确认屏蔽成立。

- [ ] **实测菜单 DOM 结构**

右键打开蓝湖菜单，**保持菜单打开**（在 Console 里操作不会关闭它），执行：

```js
const dialog = document.querySelector('.detail_context_menu_dialog');
const title = dialog && dialog.querySelector('.menu-item-title');
const item = title && title.closest('.mu-menu-item');
const row = item && item.closest('.mu-menu-list > *');
console.log('LIST_SELECTOR:', row && row.parentElement.className);
console.log('row outerHTML:', row && row.outerHTML);
console.log('titles:', dialog && [...dialog.querySelectorAll('.menu-item-title')].map(e => e.textContent.trim()));
```

把 `row outerHTML` 完整粘进 `NOTES.md`，并据此更新 `selectors.ts`。

- [ ] **实测 URL 是否跟随设计稿切换**

切换到另一张设计稿（缩略图列表或翻页），执行 `console.log(location.hash)`，确认 `image_id`（或 `docId`）随之改变，并留意 `tid` 是否仍在。

**已知行为：`tid` 会被 `changeUrlQuery` 丢弃**，所以取值走 URL → localStorage 两级 fallback（逆向结论 C）。若发现连 `localStorage.team_id` 也拿不到，记入 `NOTES.md` 并标注为阻塞项——需要回到计划阶段重新设计取值方式。

复测 localStorage 兜底是否可用：

```js
console.log('team_id:', localStorage.getItem('team_id'));
console.log('pid:', localStorage.getItem('pid'));
```

</details>

---

### Task 2: 建立 ecosystem 子包骨架

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `vitest.config.ts`
- Create: `ecosystem/browser-extension/package.json`
- Create: `ecosystem/browser-extension/tsconfig.json`
- Create: `ecosystem/browser-extension/vite.config.ts`
- Create: `ecosystem/browser-extension/scripts/build.ts`
- Create: `ecosystem/browser-extension/public/manifest.json`
- Create: `ecosystem/browser-extension/.gitignore`
- Create: `ecosystem/browser-extension/src/shared/constants.ts`
- Test: `ecosystem/browser-extension/src/shared/__tests__/constants.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: `DEFAULT_BRIDGE_PORT`(= 7623)、`BRIDGE_PATH`(= `/token`)、`LANHU_ORIGIN`、`DESIGN_DETAIL_PATH`；可运行的 `pnpm --filter @lanhu-context/browser-extension build` 产出 `dist/{background,content}.js` + `dist/manifest.json`

- [ ] **Step 1: 注册 workspace 目录**

`pnpm-workspace.yaml`：

```yaml
packages:
  - packages/*
  - ecosystem/*
```

- [ ] **Step 2: 让根 vitest 收录 ecosystem 测试**

`vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/__tests__/**/*.spec.ts',
      'ecosystem/*/src/**/__tests__/**/*.spec.ts'
    ],
    globals: true,
    testTimeout: 30_000
  }
});
```

- [ ] **Step 3: 写包声明**

`ecosystem/browser-extension/package.json`：

```json
{
  "name": "@lanhu-context/browser-extension",
  "version": "0.0.0",
  "private": true,
  "description": "蓝湖设计稿详情页浏览器扩展：复制设计稿链接、复制 Cookie、发送 Cookie 到本机",
  "type": "module",
  "scripts": {
    "build": "tsx scripts/build.ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@lanhu-context/core": "workspace:*",
    "@types/chrome": "^0.0.287",
    "jsdom": "^25.0.1",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vite": "^7.0.0"
  }
}
```

> `@lanhu-context/core` 只用于测试期交叉校验 `parseLanhuUrl` 契约，不进构建产物。

- [ ] **Step 4: 写 TS 配置**

`ecosystem/browser-extension/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["chrome", "vitest/globals"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src", "scripts", "vite.config.ts"]
}
```

- [ ] **Step 5: 写 Vite 基础配置**

`ecosystem/browser-extension/vite.config.ts`：

```ts
import { defineConfig } from 'vite';

// Shared base only; scripts/build.ts drives one build per entry because MV3
// content scripts must be classic scripts (IIFE) while the service worker
// is declared as an ES module.
export default defineConfig({
  build: {
    target: 'chrome114',
    minify: false,
    emptyOutDir: false
  }
});
```

- [ ] **Step 6: 写构建脚本**

`ecosystem/browser-extension/scripts/build.ts`：

```ts
import { cpSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist');

interface Target {
  entry: string;
  name: string;
  format: 'es' | 'iife';
}

// MV3: the service worker may be an ES module, content scripts may not.
const targets: Target[] = [
  { entry: 'src/background/index.ts', name: 'background', format: 'es' },
  { entry: 'src/content/index.ts', name: 'content', format: 'iife' }
];

rmSync(outDir, { recursive: true, force: true });

for (const target of targets) {
  await build({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: resolve(root, target.entry),
        name: `lanhuExt_${target.name}`,
        formats: [target.format],
        fileName: () => `${target.name}.js`
      }
    }
  });
}

cpSync(resolve(root, 'public'), outDir, { recursive: true });
console.log(`built -> ${outDir}`);
```

- [ ] **Step 7: 写 manifest**

`ecosystem/browser-extension/public/manifest.json`：

```json
{
  "manifest_version": 3,
  "name": "lanhu-context helper",
  "version": "0.1.0",
  "description": "在蓝湖设计稿详情页复制设计稿链接与登录 Cookie，配合 lanhu-context CLI 使用。",
  "minimum_chrome_version": "114",
  "permissions": ["cookies", "clipboardWrite"],
  "host_permissions": [
    "https://*.lanhuapp.com/*",
    "http://127.0.0.1/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://lanhuapp.com/web/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 8: 写常量与失败测试**

`ecosystem/browser-extension/src/shared/constants.ts`：

```ts
// The CLI receiver (`lanhu auth listen --port`) must default to the same port.
export const DEFAULT_BRIDGE_PORT = 7623;
export const BRIDGE_PATH = '/token';
export const LANHU_ORIGIN = 'https://lanhuapp.com';
export const DESIGN_DETAIL_PATH = 'item/project/detailDetach';
```

`ecosystem/browser-extension/src/shared/__tests__/constants.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { BRIDGE_PATH, DEFAULT_BRIDGE_PORT, LANHU_ORIGIN } from '../constants';

describe('constants', () => {
  it('pins the bridge port shared with the CLI receiver', () => {
    expect(DEFAULT_BRIDGE_PORT).toBe(7623);
    expect(BRIDGE_PATH).toBe('/token');
  });

  it('pins the lanhu origin without a trailing slash', () => {
    expect(LANHU_ORIGIN).toBe('https://lanhuapp.com');
  });
});
```

- [ ] **Step 9: 安装依赖并跑测试**

Run: `pnpm install`
Run: `pnpm vitest run ecosystem/browser-extension`
Expected: 2 tests PASS

- [ ] **Step 10: 验证构建产物**

先创建两个占位入口，避免构建失败：

```bash
mkdir -p ecosystem/browser-extension/src/background ecosystem/browser-extension/src/content
echo 'export {};' > ecosystem/browser-extension/src/background/index.ts
echo 'export {};' > ecosystem/browser-extension/src/content/index.ts
```

Run: `pnpm --filter @lanhu-context/browser-extension build`
Expected: `ecosystem/browser-extension/dist/` 下出现 `background.js`、`content.js`、`manifest.json`

- [ ] **Step 11: 加 .gitignore**

`ecosystem/browser-extension/.gitignore`：

```
dist/
```

- [ ] **Step 12: Commit**

```bash
git add pnpm-workspace.yaml vitest.config.ts ecosystem/
git commit -m "feat(extension): scaffold ecosystem browser-extension package with vite + ts"
```

---

### Task 3: 设计稿引用解析与 URL 构造（纯函数）

依据逆向结论 C：**只读 URL 会在切换设计稿后失败**（`tid` 被 `changeUrlQuery` 丢弃）。解析必须复刻蓝湖自己的 `getTeamId()` fallback 链：URL → localStorage，并把 `''` / `'undefined'` / `'null'` 视为缺失。

**Files:**
- Create: `ecosystem/browser-extension/src/shared/url.ts`
- Test: `ecosystem/browser-extension/src/shared/__tests__/url.spec.ts`

**Interfaces:**
- Consumes: `LANHU_ORIGIN`、`DESIGN_DETAIL_PATH`（Task 2）
- Produces:
  - `interface DesignRef { teamId: string; projectId: string; imageId: string }`
  - `interface StorageLike { getItem(key: string): string | null }`
  - `parseHashParams(href: string): URLSearchParams | null`
  - `resolveDesignRef(href: string, storage: StorageLike): DesignRef | null`
  - `buildDesignUrl(ref: DesignRef): string`

- [ ] **Step 1: 写失败测试**

`ecosystem/browser-extension/src/shared/__tests__/url.spec.ts`：

```ts
import { parseLanhuUrl } from '@lanhu-context/core';
import { describe, expect, it } from 'vitest';
import {
  buildDesignUrl,
  parseHashParams,
  resolveDesignRef,
  type StorageLike
} from '../url';

const FULL =
  'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T1&pid=P1&image_id=I1';

/** URL shape after lanhu's changeUrlQuery drops tid on a design switch. */
const SWITCHED =
  'https://lanhuapp.com/web/#/item/project/detailDetach?pid=P1&project_id=P1&image_id=I2';

function store(map: Record<string, string>): StorageLike {
  return { getItem: (key) => map[key] ?? null };
}

const EMPTY = store({});

describe('parseHashParams', () => {
  it('reads the query that follows the hash', () => {
    expect(parseHashParams(FULL)?.get('tid')).toBe('T1');
  });

  it('ignores the search string before the hash', () => {
    const href =
      'https://lanhuapp.com/web/?from=share#/item/project/detailDetach?tid=T3';
    expect(parseHashParams(href)?.get('tid')).toBe('T3');
  });

  it('returns null when there is no hash query', () => {
    expect(parseHashParams('https://lanhuapp.com/web/#/item')).toBeNull();
    expect(parseHashParams('https://lanhuapp.com/web/')).toBeNull();
  });
});

describe('resolveDesignRef', () => {
  it('reads everything from the url when tid is present', () => {
    expect(resolveDesignRef(FULL, EMPTY)).toEqual({
      teamId: 'T1',
      projectId: 'P1',
      imageId: 'I1'
    });
  });

  it('falls back to localStorage team_id after a design switch drops tid', () => {
    expect(resolveDesignRef(SWITCHED, store({ team_id: 'T9' }))).toEqual({
      teamId: 'T9',
      projectId: 'P1',
      imageId: 'I2'
    });
  });

  it('falls back to localStorage pid when the url carries neither pid alias', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?image_id=I1';
    expect(resolveDesignRef(href, store({ team_id: 'T9', pid: 'P9' }))).toEqual({
      teamId: 'T9',
      projectId: 'P9',
      imageId: 'I1'
    });
  });

  it('prefers the url over storage for teamId', () => {
    expect(resolveDesignRef(FULL, store({ team_id: 'STALE' }))?.teamId).toBe(
      'T1'
    );
  });

  it('accepts the team_id url alias as well as tid', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?team_id=T5&pid=P1&image_id=I1';
    expect(resolveDesignRef(href, EMPTY)?.teamId).toBe('T5');
  });

  it('accepts the project_id and docId aliases', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T2&project_id=P2&docId=D2';
    expect(resolveDesignRef(href, EMPTY)).toEqual({
      teamId: 'T2',
      projectId: 'P2',
      imageId: 'D2'
    });
  });

  it('prefers pid over project_id when lanhu sends both', () => {
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T&project_id=OLD&pid=NEW&image_id=I';
    expect(resolveDesignRef(href, EMPTY)?.projectId).toBe('NEW');
  });

  it('treats the literal string "undefined" in storage as absent', () => {
    // common/utils/tip-team.js writes localStorage.team_id = "undefined".
    expect(resolveDesignRef(SWITCHED, store({ team_id: 'undefined' }))).toBeNull();
  });

  it('treats an empty stored value as absent', () => {
    // item/api/account-project.js writes localStorage.pid = "".
    const href =
      'https://lanhuapp.com/web/#/item/project/detailDetach?image_id=I1';
    expect(resolveDesignRef(href, store({ team_id: 'T9', pid: '' }))).toBeNull();
  });

  it('never falls back to storage for imageId', () => {
    // A stale stored image_id would silently copy the wrong design.
    const href = 'https://lanhuapp.com/web/#/item/project/detailDetach?pid=P1';
    expect(
      resolveDesignRef(href, store({ team_id: 'T9', image_id: 'STALE' }))
    ).toBeNull();
  });

  it('ignores extra params lanhu appends', () => {
    const href = `${FULL}&comment_id=C1&version_id=V1`;
    expect(resolveDesignRef(href, EMPTY)).toEqual({
      teamId: 'T1',
      projectId: 'P1',
      imageId: 'I1'
    });
  });

  it('returns null when there is no hash query at all', () => {
    expect(
      resolveDesignRef('https://lanhuapp.com/web/', store({ team_id: 'T9' }))
    ).toBeNull();
  });

  it('survives a storage accessor that throws', () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      }
    };
    expect(resolveDesignRef(FULL, hostile)?.teamId).toBe('T1');
    expect(resolveDesignRef(SWITCHED, hostile)).toBeNull();
  });
});

describe('buildDesignUrl', () => {
  const ref = { teamId: 'T1', projectId: 'P1', imageId: 'I1' };

  it('builds a canonical detailDetach url', () => {
    expect(buildDesignUrl(ref)).toBe(
      'https://lanhuapp.com/web/#/item/project/detailDetach?tid=T1&pid=P1&image_id=I1'
    );
  });

  it('round-trips through the CLI parser', () => {
    const parsed = parseLanhuUrl(buildDesignUrl(ref));
    expect(parsed.teamId).toBe('T1');
    expect(parsed.projectId).toBe('P1');
    expect(parsed.docId).toBe('I1');
  });

  it('re-adds tid that the live url had lost', () => {
    // The whole point: a switched-to design still yields a CLI-usable link.
    const resolved = resolveDesignRef(SWITCHED, store({ team_id: 'T9' }));
    const parsed = parseLanhuUrl(buildDesignUrl(resolved!));
    expect(parsed.teamId).toBe('T9');
    expect(parsed.docId).toBe('I2');
  });

  it('percent-encodes ids that contain url-unsafe characters', () => {
    const url = buildDesignUrl({ ...ref, imageId: 'a b&c' });
    expect(url).toContain('image_id=a+b%26c');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run ecosystem/browser-extension/src/shared/__tests__/url.spec.ts`
Expected: FAIL — `Failed to resolve import "../url"`

- [ ] **Step 3: 实现**

`ecosystem/browser-extension/src/shared/url.ts`：

```ts
import { DESIGN_DETAIL_PATH, LANHU_ORIGIN } from './constants';

export interface DesignRef {
  teamId: string;
  projectId: string;
  imageId: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
}

// Lanhu writes literal "undefined" (common/utils/tip-team.js) and ""
// (item/api/account-project.js) into these keys, so a truthiness check alone
// would happily hand back the string "undefined" as a team id.
const PLACEHOLDERS = new Set(['', 'undefined', 'null']);

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return PLACEHOLDERS.has(trimmed) ? null : trimmed;
}

/**
 * Lanhu routes through a hash fragment, so the ids live after the `#`, not in
 * `location.search`.
 */
export function parseHashParams(href: string): URLSearchParams | null {
  const hashIndex = href.indexOf('#');
  if (hashIndex === -1) return null;

  const fragment = href.slice(hashIndex + 1);
  const queryIndex = fragment.indexOf('?');
  if (queryIndex === -1) return null;

  return new URLSearchParams(fragment.slice(queryIndex + 1));
}

/**
 * Mirrors lanhu's own getTeamId() chain: url first, then localStorage.
 *
 * This is not defensive padding — MarkLeft.changeUrlQuery rewrites the query
 * to {pid, project_id, image_id} whenever the user switches designs, so the
 * url loses `tid` on the most common path through the page.
 *
 * imageId deliberately has no storage fallback: it is always present in the
 * url, and a stale stored value would silently reference the wrong design.
 */
export function resolveDesignRef(
  href: string,
  storage: StorageLike
): DesignRef | null {
  const params = parseHashParams(href);

  const fromUrl = (...keys: string[]): string | null => {
    if (!params) return null;
    for (const key of keys) {
      const value = clean(params.get(key));
      if (value) return value;
    }
    return null;
  };

  const fromStorage = (key: string): string | null => {
    try {
      return clean(storage.getItem(key));
    } catch {
      // Storage access can throw when the page blocks it.
      return null;
    }
  };

  const teamId = fromUrl('tid', 'team_id') ?? fromStorage('team_id');
  const projectId = fromUrl('pid', 'project_id') ?? fromStorage('pid');
  const imageId = fromUrl('image_id', 'docId');

  if (!teamId || !projectId || !imageId) return null;
  return { teamId, projectId, imageId };
}

/**
 * Rebuilds the canonical three-param form — including the `tid` the live url
 * may have dropped. Lanhu's own links carry extra params (comment_id,
 * version_id, …) that the CLI ignores; dropping them keeps the copied link
 * short and stable.
 */
export function buildDesignUrl(ref: DesignRef): string {
  const params = new URLSearchParams({
    tid: ref.teamId,
    pid: ref.projectId,
    image_id: ref.imageId
  });
  return `${LANHU_ORIGIN}/web/#/${DESIGN_DETAIL_PATH}?${params.toString()}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run ecosystem/browser-extension/src/shared/__tests__/url.spec.ts`
Expected: 21 tests PASS

- [ ] **Step 5: Commit**

```bash
git add ecosystem/browser-extension/src/shared/url.ts ecosystem/browser-extension/src/shared/__tests__/url.spec.ts
git commit -m "feat(extension): resolve design refs from url with localStorage fallback"
```

---

### Task 4: Cookie 序列化（纯函数）

**Files:**
- Create: `ecosystem/browser-extension/src/shared/cookies.ts`
- Test: `ecosystem/browser-extension/src/shared/__tests__/cookies.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface CookieLike { name: string; value: string; path?: string }`
  - `sortCookies(cookies: CookieLike[]): CookieLike[]`
  - `formatCookieHeader(cookies: CookieLike[]): string`

- [ ] **Step 1: 写失败测试**

`ecosystem/browser-extension/src/shared/__tests__/cookies.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { formatCookieHeader, sortCookies } from '../cookies';

describe('formatCookieHeader', () => {
  it('joins name=value pairs with "; "', () => {
    expect(
      formatCookieHeader([
        { name: 'sid', value: 'FAKE1' },
        { name: 'uid', value: 'FAKE2' }
      ])
    ).toBe('sid=FAKE1; uid=FAKE2');
  });

  it('drops entries with an empty name', () => {
    expect(
      formatCookieHeader([
        { name: '', value: 'x' },
        { name: 'sid', value: 'FAKE1' }
      ])
    ).toBe('sid=FAKE1');
  });

  it('keeps cookies whose value is an empty string', () => {
    expect(formatCookieHeader([{ name: 'flag', value: '' }])).toBe('flag=');
  });

  it('returns an empty string for no cookies', () => {
    expect(formatCookieHeader([])).toBe('');
  });

  it('emits values verbatim without re-encoding', () => {
    expect(formatCookieHeader([{ name: 'a', value: 'x%20y' }])).toBe('a=x%20y');
  });
});

describe('sortCookies', () => {
  it('orders longer paths first, per RFC 6265 §5.4', () => {
    const sorted = sortCookies([
      { name: 'root', value: '1', path: '/' },
      { name: 'deep', value: '2', path: '/web/detail' },
      { name: 'mid', value: '3', path: '/web' }
    ]);
    expect(sorted.map((c) => c.name)).toEqual(['deep', 'mid', 'root']);
  });

  it('is stable for equal path lengths', () => {
    const sorted = sortCookies([
      { name: 'a', value: '1', path: '/x' },
      { name: 'b', value: '2', path: '/y' }
    ]);
    expect(sorted.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('treats a missing path as "/"', () => {
    const sorted = sortCookies([
      { name: 'none', value: '1' },
      { name: 'deep', value: '2', path: '/web' }
    ]);
    expect(sorted[0]?.name).toBe('deep');
  });

  it('does not mutate the input array', () => {
    const input = [
      { name: 'root', value: '1', path: '/' },
      { name: 'deep', value: '2', path: '/web' }
    ];
    sortCookies(input);
    expect(input[0]?.name).toBe('root');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run ecosystem/browser-extension/src/shared/__tests__/cookies.spec.ts`
Expected: FAIL — `Failed to resolve import "../cookies"`

- [ ] **Step 3: 实现**

`ecosystem/browser-extension/src/shared/cookies.ts`：

```ts
export interface CookieLike {
  name: string;
  value: string;
  path?: string;
}

/**
 * Browsers send longer-path cookies first (RFC 6265 §5.4). chrome.cookies
 * exposes no creation time, so path length is the only ordering signal we can
 * reproduce; Array.prototype.sort is stable, which preserves enumeration
 * order for ties.
 */
export function sortCookies(cookies: CookieLike[]): CookieLike[] {
  return [...cookies].sort(
    (a, b) => (b.path ?? '/').length - (a.path ?? '/').length
  );
}

/**
 * Serializes to a Cookie request-header value. Values are emitted verbatim:
 * chrome.cookies already returns them in transport form, so encoding here
 * would corrupt the credential.
 */
export function formatCookieHeader(cookies: CookieLike[]): string {
  return sortCookies(cookies)
    .filter((cookie) => cookie.name.length > 0)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run ecosystem/browser-extension/src/shared/__tests__/cookies.spec.ts`
Expected: 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add ecosystem/browser-extension/src/shared/cookies.ts ecosystem/browser-extension/src/shared/__tests__/cookies.spec.ts
git commit -m "feat(extension): serialize chrome cookies into a Cookie header value"
```

---

### Task 5: Service worker 的 Cookie 采集与投递

**Files:**
- Create: `ecosystem/browser-extension/src/background/collect.ts`
- Test: `ecosystem/browser-extension/src/background/__tests__/collect.spec.ts`

**Interfaces:**
- Consumes: `formatCookieHeader`（Task 4）、`BRIDGE_PATH`（Task 2）
- Produces:
  - `interface CookieApi { getAll(details: { domain: string }): Promise<CookieLike[]> }`
  - `collectCookieHeader(api: CookieApi): Promise<string>` —— 无 cookie 时抛 `Error('NO_COOKIES')`
  - `interface SendResult { ok: boolean; status?: number; error?: string }`
  - `sendCookieHeader(fetchFn: typeof fetch, port: number, token: string): Promise<SendResult>`

- [ ] **Step 1: 写失败测试**

`ecosystem/browser-extension/src/background/__tests__/collect.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { collectCookieHeader, sendCookieHeader } from '../collect';

describe('collectCookieHeader', () => {
  it('queries the lanhuapp.com domain and serializes the result', async () => {
    const getAll = vi.fn().mockResolvedValue([
      { name: 'sid', value: 'FAKE1', path: '/' },
      { name: 'uid', value: 'FAKE2', path: '/web' }
    ]);
    await expect(collectCookieHeader({ getAll })).resolves.toBe(
      'uid=FAKE2; sid=FAKE1'
    );
    expect(getAll).toHaveBeenCalledWith({ domain: 'lanhuapp.com' });
  });

  it('throws NO_COOKIES when the browser has none', async () => {
    const getAll = vi.fn().mockResolvedValue([]);
    await expect(collectCookieHeader({ getAll })).rejects.toThrow('NO_COOKIES');
  });
});

describe('sendCookieHeader', () => {
  it('posts json to the local receiver', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    const result = await sendCookieHeader(
      fetchFn as unknown as typeof fetch,
      7623,
      'sid=FAKE1'
    );

    expect(result).toEqual({ ok: true, status: 200 });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:7623/token');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ lanhuToken: 'sid=FAKE1' });
  });

  it('reports a non-2xx status as a failure', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403 } as Response);
    const result = await sendCookieHeader(
      fetchFn as unknown as typeof fetch,
      7623,
      'sid=FAKE1'
    );
    expect(result).toEqual({ ok: false, status: 403 });
  });

  it('turns a connection refusal into a readable error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await sendCookieHeader(
      fetchFn as unknown as typeof fetch,
      7623,
      'sid=FAKE1'
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Failed to fetch');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run ecosystem/browser-extension/src/background`
Expected: FAIL — `Failed to resolve import "../collect"`

- [ ] **Step 3: 实现**

`ecosystem/browser-extension/src/background/collect.ts`：

```ts
import { BRIDGE_PATH } from '../shared/constants';
import { type CookieLike, formatCookieHeader } from '../shared/cookies';

export interface CookieApi {
  getAll(details: { domain: string }): Promise<CookieLike[]>;
}

export interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * chrome.cookies.getAll matches subdomains too, and unlike document.cookie it
 * returns HttpOnly entries — which is the whole reason this ships as an
 * extension rather than a userscript.
 */
export async function collectCookieHeader(api: CookieApi): Promise<string> {
  const cookies = await api.getAll({ domain: 'lanhuapp.com' });
  const header = formatCookieHeader(cookies);
  if (!header) throw new Error('NO_COOKIES');
  return header;
}

export async function sendCookieHeader(
  fetchFn: typeof fetch,
  port: number,
  token: string
): Promise<SendResult> {
  try {
    const response = await fetchFn(`http://127.0.0.1:${port}${BRIDGE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lanhuToken: token })
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run ecosystem/browser-extension/src/background`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add ecosystem/browser-extension/src/background
git commit -m "feat(extension): collect lanhu cookies and post them to the local receiver"
```

---

### Task 6: 菜单项注入蓝湖 popover（DOM）

依据 Task 1 实测：菜单每次右键都重建，必须持续观察；注入项必须拦截 `mouseup`，否则宿主会在 `click` 前关闭菜单；**菜单项是 5 层嵌套，标题不是 `.mu-menu-item` 的直接子节点**；列表容器是 `.mu-menu-list`。

**Files:**
- Create: `ecosystem/browser-extension/src/content/menu.ts`
- Test: `ecosystem/browser-extension/src/content/__tests__/menu.spec.ts`

**Interfaces:**
- Consumes: `selectors.ts` 的全部导出（Task 1 已产出）
- Produces:
  - `interface MenuItemSpec { id: string; label: string; onSelect: () => void; badge?: string }`
  - `buildMenuItem(spec: MenuItemSpec): HTMLElement`
  - `injectInto(dialog: HTMLElement, specs: MenuItemSpec[]): boolean`
  - `installMenuInjector(root: Node, specs: MenuItemSpec[]): () => void`

- [ ] **Step 1: 写失败测试**

`ecosystem/browser-extension/src/content/__tests__/menu.spec.ts`：

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMenuItem, injectInto, installMenuInjector } from '../menu';
import {
  BADGE_CLASS,
  ITEM_SELECTOR,
  RIPPLE_CLASS,
  TITLE_BOX_CLASS,
  TITLE_CLASS,
  WRAPPER_CLASS
} from '../selectors';

const specs = [
  { id: 'copy-design-url', label: '复制选中设计稿链接', onSelect: vi.fn() },
  { id: 'copy-cookies', label: '复制 cookies', onSelect: vi.fn() },
  { id: 'send-cookies', label: '发送 cookies 到本机', onSelect: vi.fn() }
];

/**
 * Verbatim host markup captured in NOTES.md: popover > .mu-menu >
 * .mu-menu-list > one native row ("返回"), plus a row injected by the
 * third-party helper that was present during recon.
 */
function makeDialog(): HTMLElement {
  const dialog = document.createElement('div');
  dialog.className = 'mu-popover detail_context_menu_dialog';
  dialog.innerHTML = `
    <div tabindex="0" class="mu-menu" style="width: 200px;">
      <div class="mu-menu-list" style="width: 200px;">
        <!---->
        <div data-lanhu-helper-copy-link="1">
          <div class="mu-menu-item-wrapper" tabindex="0" data-lanhu-helper-copy-link="1">
            <div class="">
              <div class="mu-ripple-wrapper"></div>
              <div class="mu-menu-item">
                <div class="mu-menu-item-title"><span class="menu-item-title">复制选中图层链接</span></div>
                <div><span class="key-icon"><span class="hotkey">⚡MCP</span></span></div>
              </div>
            </div>
          </div>
        </div>
        <div>
          <div class="mu-menu-item-wrapper" tabindex="0">
            <div class="">
              <div class="mu-ripple-wrapper"></div>
              <div class="mu-menu-item">
                <div class="mu-menu-item-title"><span class="menu-item-title">返回</span></div>
                <div><span class="key-icon"><span class="hotkey">esc</span></span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  return dialog;
}

const HOST_ITEMS = 2; // the third-party row plus 返回

function itemCount(root: ParentNode): number {
  return root.querySelectorAll(ITEM_SELECTOR).length;
}

beforeEach(() => {
  document.body.innerHTML = '';
  for (const spec of specs) spec.onSelect.mockClear();
});

describe('buildMenuItem', () => {
  it('reproduces the host row nesting exactly', () => {
    const row = buildMenuItem(specs[0]!);
    const wrapper = row.firstElementChild as HTMLElement;
    expect(wrapper.className).toBe(WRAPPER_CLASS);
    expect(wrapper.getAttribute('tabindex')).toBe('0');

    const inner = wrapper.firstElementChild as HTMLElement;
    expect(inner.firstElementChild?.className).toBe(RIPPLE_CLASS);

    const item = inner.querySelector(ITEM_SELECTOR);
    expect(item).not.toBeNull();
    // The title lives one level below .mu-menu-item, not directly inside it.
    expect(item?.firstElementChild?.className).toBe(TITLE_BOX_CLASS);
  });

  it('renders the label into the title span', () => {
    const row = buildMenuItem(specs[0]!);
    expect(row.querySelector(`.${TITLE_CLASS}`)?.textContent).toBe(
      '复制选中设计稿链接'
    );
  });

  it('renders a badge when one is supplied', () => {
    const row = buildMenuItem({ ...specs[0]!, badge: 'CLI' });
    expect(row.querySelector(`.${BADGE_CLASS}`)?.textContent).toBe('CLI');
  });

  it('leaves the trailing slot empty when no badge is supplied', () => {
    const row = buildMenuItem(specs[0]!);
    expect(row.querySelector(`.${BADGE_CLASS}`)).toBeNull();
  });

  it('namespaces its marker away from the third-party injector', () => {
    const row = buildMenuItem(specs[0]!);
    expect(row.dataset.lanhuExtItem).toBe('copy-design-url');
    expect(row.hasAttribute('data-lanhu-helper-copy-link')).toBe(false);
  });

  it('invokes onSelect on click', () => {
    const row = buildMenuItem(specs[0]!);
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(specs[0]!.onSelect).toHaveBeenCalledOnce();
  });

  it('invokes onSelect when the click lands on the inner title span', () => {
    const row = buildMenuItem(specs[0]!);
    document.body.append(row);
    row
      .querySelector(`.${TITLE_CLASS}`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(specs[0]!.onSelect).toHaveBeenCalledOnce();
  });

  it('stops mouseup from bubbling so lanhu does not close the menu first', () => {
    const row = buildMenuItem(specs[0]!);
    document.body.append(row);
    const onBodyMouseUp = vi.fn();
    document.body.addEventListener('mouseup', onBodyMouseUp);
    row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(onBodyMouseUp).not.toHaveBeenCalled();
  });

  it('stops contextmenu from re-triggering the host handler', () => {
    const row = buildMenuItem(specs[0]!);
    document.body.append(row);
    const onBodyContextMenu = vi.fn();
    document.body.addEventListener('contextmenu', onBodyContextMenu);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(onBodyContextMenu).not.toHaveBeenCalled();
  });
});

describe('injectInto', () => {
  it('appends every spec into .mu-menu-list', () => {
    const dialog = makeDialog();
    expect(injectInto(dialog, specs)).toBe(true);
    expect(itemCount(dialog)).toBe(HOST_ITEMS + specs.length);
    expect(dialog.querySelector('.mu-menu-list')?.children).toHaveLength(
      HOST_ITEMS + specs.length
    );
  });

  it('leaves the host rows untouched', () => {
    const dialog = makeDialog();
    injectInto(dialog, specs);
    const titles = [...dialog.querySelectorAll(`.${TITLE_CLASS}`)].map((e) =>
      e.textContent
    );
    expect(titles.slice(0, HOST_ITEMS)).toEqual(['复制选中图层链接', '返回']);
  });

  it('is idempotent for a dialog it already touched', () => {
    const dialog = makeDialog();
    injectInto(dialog, specs);
    expect(injectInto(dialog, specs)).toBe(false);
    expect(itemCount(dialog)).toBe(HOST_ITEMS + specs.length);
  });

  it('returns false when the menu list is missing', () => {
    const dialog = document.createElement('div');
    dialog.className = 'detail_context_menu_dialog';
    expect(injectInto(dialog, specs)).toBe(false);
  });

  it('does not append to .mu-menu when .mu-menu-list is absent', () => {
    const dialog = document.createElement('div');
    dialog.className = 'detail_context_menu_dialog';
    dialog.innerHTML = '<div class="mu-menu"></div>';
    expect(injectInto(dialog, specs)).toBe(false);
    expect(itemCount(dialog)).toBe(0);
  });
});

describe('installMenuInjector', () => {
  it('injects into dialogs added after install', async () => {
    const dispose = installMenuInjector(document.body, specs);
    const dialog = makeDialog();
    document.body.append(dialog);

    await vi.waitFor(() =>
      expect(itemCount(dialog)).toBe(HOST_ITEMS + specs.length)
    );
    dispose();
  });

  it('injects into a dialog nested inside an added subtree', async () => {
    const dispose = installMenuInjector(document.body, specs);
    const wrapper = document.createElement('div');
    wrapper.append(makeDialog());
    document.body.append(wrapper);

    await vi.waitFor(() =>
      expect(itemCount(wrapper)).toBe(HOST_ITEMS + specs.length)
    );
    dispose();
  });

  it('re-injects when lanhu rebuilds the menu on the next right-click', async () => {
    const dispose = installMenuInjector(document.body, specs);
    const first = makeDialog();
    document.body.append(first);
    await vi.waitFor(() =>
      expect(itemCount(first)).toBe(HOST_ITEMS + specs.length)
    );

    first.remove();
    const second = makeDialog();
    document.body.append(second);
    await vi.waitFor(() =>
      expect(itemCount(second)).toBe(HOST_ITEMS + specs.length)
    );
    dispose();
  });

  it('stops injecting after dispose', async () => {
    const dispose = installMenuInjector(document.body, specs);
    dispose();
    const dialog = makeDialog();
    document.body.append(dialog);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(itemCount(dialog)).toBe(HOST_ITEMS);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run ecosystem/browser-extension/src/content`
Expected: FAIL — `Failed to resolve import "../menu"`

- [ ] **Step 3: 实现**

`ecosystem/browser-extension/src/content/menu.ts`：

```ts
import {
  BADGE_BOX_CLASS,
  BADGE_CLASS,
  DIALOG_SELECTOR,
  ITEM_CLASS,
  LIST_SELECTOR,
  RIPPLE_CLASS,
  TITLE_BOX_CLASS,
  TITLE_CLASS,
  WRAPPER_CLASS,
  WRAPPER_STYLE
} from './selectors';

export interface MenuItemSpec {
  id: string;
  label: string;
  onSelect: () => void;
  /** Optional right-aligned chip, matching the host's `esc` hotkey slot. */
  badge?: string;
}

const INJECTED_FLAG = 'lanhuExtInjected';
const ITEM_FLAG = 'lanhuExtItem';

/**
 * Rebuilds the host's row markup node for node (see NOTES.md). muse-ui styles
 * key off this exact nesting, so a flatter approximation renders unstyled:
 *
 *   div[data-lanhu-ext-item]
 *     div.mu-menu-item-wrapper
 *       div
 *         div.mu-ripple-wrapper
 *         div.mu-menu-item
 *           div.mu-menu-item-title > span.menu-item-title
 *           div > span.key-icon > span.hotkey
 */
export function buildMenuItem(spec: MenuItemSpec): HTMLElement {
  const row = document.createElement('div');
  row.dataset[ITEM_FLAG] = spec.id;

  const wrapper = document.createElement('div');
  wrapper.className = WRAPPER_CLASS;
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'menuitem');
  wrapper.setAttribute('style', WRAPPER_STYLE);

  const inner = document.createElement('div');

  const ripple = document.createElement('div');
  ripple.className = RIPPLE_CLASS;

  const item = document.createElement('div');
  item.className = ITEM_CLASS;

  const titleBox = document.createElement('div');
  titleBox.className = TITLE_BOX_CLASS;
  const title = document.createElement('span');
  title.className = TITLE_CLASS;
  title.textContent = spec.label;
  titleBox.append(title);

  const afterBox = document.createElement('div');
  if (spec.badge) {
    const keyIcon = document.createElement('span');
    keyIcon.className = BADGE_BOX_CLASS;
    const hotkey = document.createElement('span');
    hotkey.className = BADGE_CLASS;
    hotkey.textContent = spec.badge;
    keyIcon.append(hotkey);
    afterBox.append(keyIcon);
  }

  item.append(titleBox, afterBox);
  inner.append(ripple, item);
  wrapper.append(inner);
  row.append(wrapper);

  // Listeners sit on the row so clicks anywhere inside the nesting count.
  // The host closes its menu on a bubbling mouseup, which would tear the
  // popover down before click ever fires.
  row.addEventListener('mouseup', (event) => event.stopPropagation());
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  row.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    spec.onSelect();
  });

  return row;
}

export function injectInto(
  dialog: HTMLElement,
  specs: MenuItemSpec[]
): boolean {
  if (dialog.dataset[INJECTED_FLAG] === '1') return false;
  // Must be .mu-menu-list, not .mu-menu — appending to the latter drops the
  // rows outside the list box.
  const list = dialog.querySelector(LIST_SELECTOR);
  if (!list) return false;

  dialog.dataset[INJECTED_FLAG] = '1';
  for (const spec of specs) list.append(buildMenuItem(spec));
  return true;
}

/**
 * Lanhu mounts and unmounts the popover on every right-click, so the injector
 * has to observe rather than run once.
 */
export function installMenuInjector(
  root: Node,
  specs: MenuItemSpec[]
): () => void {
  const scan = (node: Node): void => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(DIALOG_SELECTOR)) injectInto(node, specs);
    for (const nested of node.querySelectorAll<HTMLElement>(DIALOG_SELECTOR)) {
      injectInto(nested, specs);
    }
  };

  if (root instanceof HTMLElement) scan(root);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const added of record.addedNodes) scan(added);
    }
  });
  observer.observe(root, { childList: true, subtree: true });

  return () => observer.disconnect();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run ecosystem/browser-extension/src/content`
Expected: 18 tests PASS

- [ ] **Step 5: Commit**

```bash
git add ecosystem/browser-extension/src/content
git commit -m "feat(extension): inject menu items into lanhu's own context menu popover"
```

---

### Task 7: 接线（content script + service worker 入口）

**Files:**
- Create: `ecosystem/browser-extension/src/shared/protocol.ts`
- Create: `ecosystem/browser-extension/src/content/clipboard.ts`
- Test: `ecosystem/browser-extension/src/content/__tests__/clipboard.spec.ts`
- Modify: `ecosystem/browser-extension/src/content/index.ts`（替换占位）
- Modify: `ecosystem/browser-extension/src/background/index.ts`（替换占位）

**Interfaces:**
- Consumes: `resolveDesignRef` / `buildDesignUrl`（T3）、`collectCookieHeader` / `sendCookieHeader`（T5）、`installMenuInjector` / `MenuItemSpec`（T6）
- Produces:
  - `type BackgroundMessage = { type: 'copy-cookies' } | { type: 'send-cookies' }`
  - `type BackgroundReply = { ok: true; token?: string } | { ok: false; error: string }`
  - `copyText(text: string): Promise<boolean>`

- [ ] **Step 1: 定义消息协议**

`ecosystem/browser-extension/src/shared/protocol.ts`：

```ts
export type BackgroundMessage =
  | { type: 'copy-cookies' }
  | { type: 'send-cookies' };

export type BackgroundReply =
  | { ok: true; token?: string }
  | { ok: false; error: string };
```

- [ ] **Step 2: 写剪贴板失败测试**

`ecosystem/browser-extension/src/content/__tests__/clipboard.spec.ts`：

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('copyText', () => {
  it('uses the async clipboard api when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when the clipboard api rejects', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });

    await expect(copyText('hello')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    // The scratch textarea must not be left in the page.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports failure when both paths fail', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false)
    });
    await expect(copyText('hello')).resolves.toBe(false);
  });

  it('survives a missing clipboard api entirely', async () => {
    vi.stubGlobal('navigator', {});
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(true)
    });
    await expect(copyText('hello')).resolves.toBe(true);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run ecosystem/browser-extension/src/content/__tests__/clipboard.spec.ts`
Expected: FAIL — `Failed to resolve import "../clipboard"`

- [ ] **Step 4: 实现剪贴板**

`ecosystem/browser-extension/src/content/clipboard.ts`：

```ts
/**
 * The async clipboard API needs a focused document; dismissing a right-click
 * menu can leave focus somewhere that trips it, so keep the execCommand
 * fallback.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyViaTextarea(text);
  }
}

function copyViaTextarea(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run ecosystem/browser-extension/src/content/__tests__/clipboard.spec.ts`
Expected: 4 tests PASS

- [ ] **Step 6: 写 content script 入口**

`ecosystem/browser-extension/src/content/index.ts`：

```ts
import type {
  BackgroundMessage,
  BackgroundReply
} from '../shared/protocol';
import { buildDesignUrl, resolveDesignRef } from '../shared/url';
import { copyText } from './clipboard';
import { installMenuInjector, type MenuItemSpec } from './menu';

function toast(message: string): void {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = [
    'position:fixed',
    'z-index:99999',
    'left:50%',
    'top:24px',
    'transform:translateX(-50%)',
    'padding:8px 16px',
    'border-radius:4px',
    'background:rgba(0,0,0,.82)',
    'color:#fff',
    'font-size:13px',
    'pointer-events:none'
  ].join(';');
  document.body.append(el);
  setTimeout(() => el.remove(), 2400);
}

function ask(message: BackgroundMessage): Promise<BackgroundReply> {
  return chrome.runtime.sendMessage(message) as Promise<BackgroundReply>;
}

async function copyDesignUrl(): Promise<void> {
  // Content scripts share the page origin, so this is the same localStorage
  // lanhu itself falls back to when the url has no tid.
  const ref = resolveDesignRef(location.href, localStorage);
  if (!ref) {
    toast('未识别到设计稿参数（需要 tid / pid / image_id）');
    return;
  }
  const ok = await copyText(buildDesignUrl(ref));
  toast(ok ? '已复制设计稿链接' : '复制失败，请检查剪贴板权限');
}

async function copyCookies(): Promise<void> {
  const reply = await ask({ type: 'copy-cookies' });
  if (!reply.ok) {
    toast(`获取 Cookie 失败：${reply.error}`);
    return;
  }
  if (!reply.token) {
    toast('获取 Cookie 失败：返回为空');
    return;
  }
  const ok = await copyText(reply.token);
  toast(ok ? '已复制 Cookie，可粘贴到 lanhu auth set' : '复制失败');
}

async function sendCookies(): Promise<void> {
  const reply = await ask({ type: 'send-cookies' });
  toast(reply.ok ? '已发送到本机 lanhu auth listen' : `发送失败：${reply.error}`);
}

const specs: MenuItemSpec[] = [
  {
    id: 'copy-design-url',
    label: '复制选中设计稿链接',
    badge: 'CLI',
    onSelect: () => void copyDesignUrl()
  },
  {
    id: 'copy-cookies',
    label: '复制 cookies',
    badge: 'CLI',
    onSelect: () => void copyCookies()
  },
  {
    id: 'send-cookies',
    label: '发送 cookies 到本机',
    badge: 'CLI',
    onSelect: () => void sendCookies()
  }
];

installMenuInjector(document.body, specs);
```

- [ ] **Step 7: 写 service worker 入口**

`ecosystem/browser-extension/src/background/index.ts`：

```ts
import { DEFAULT_BRIDGE_PORT } from '../shared/constants';
import type { BackgroundMessage, BackgroundReply } from '../shared/protocol';
import { collectCookieHeader, sendCookieHeader } from './collect';

async function handle(message: BackgroundMessage): Promise<BackgroundReply> {
  try {
    const token = await collectCookieHeader(chrome.cookies);
    if (message.type === 'copy-cookies') return { ok: true, token };

    const result = await sendCookieHeader(fetch, DEFAULT_BRIDGE_PORT, token);
    if (result.ok) return { ok: true };
    return {
      ok: false,
      error:
        result.error ??
        `本机接收端返回 ${result.status}（请先运行 lanhu auth listen）`
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error:
        reason === 'NO_COOKIES'
          ? '未找到 lanhuapp.com 的 Cookie，请先登录'
          : reason
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message as BackgroundMessage).then(sendResponse);
  return true; // keep the message channel open for the async reply
});
```

- [ ] **Step 8: 类型检查与构建**

Run: `pnpm --filter @lanhu-context/browser-extension typecheck`
Expected: 无错误

Run: `pnpm --filter @lanhu-context/browser-extension build`
Expected: `dist/` 下产出 `background.js`、`content.js`、`manifest.json`

- [ ] **Step 9: 手动加载验收**

1. Chrome → `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选 `ecosystem/browser-extension/dist`
2. 打开设计稿页面并右键
3. 断言：蓝湖菜单底部出现三个新菜单项
4. 点「复制选中设计稿链接」→ 粘贴到编辑器，断言形如
   `https://lanhuapp.com/web/#/item/project/detailDetach?tid=..&pid=..&image_id=..`
5. 用该 URL 跑 `pnpm lanhu parse "<粘贴的URL>"`，断言解析出 tid/pid/image_id 且退出码为 0
6. 关闭菜单，再次右键，重复第 3 步——断言菜单项仍然出现（验证 MutationObserver 重注入）
7. 点「复制 cookies」→ 粘贴到**临时文件**（勿提交），断言含多个 `k=v; ` 段，且长度明显大于 Console 里 `document.cookie` 的输出（证明取到了 HttpOnly）
8. 点「发送 cookies 到本机」→ 断言 toast 显示「发送失败」（此时 CLI 接收端尚未实现，属预期）

- [ ] **Step 10: Commit**

```bash
git add ecosystem/browser-extension/src
git commit -m "feat(extension): wire the three context menu actions end to end"
```

---

### Task 8: CLI 本机接收端 `lanhu auth listen`

**Files:**
- Create: `packages/cli/src/io/bridge-server.ts`
- Test: `packages/cli/src/io/__tests__/bridge-server.spec.ts`
- Modify: `packages/cli/src/commands/auth.ts`

**Interfaces:**
- Consumes: `LanhuError`（`@lanhu-context/core`）、`writeUserConfig`、`maskSecret`、`executeCommand`、`globalArgs`
- Produces:
  - `interface BridgePayload { lanhuToken: string; ddsToken?: string }`
  - `isAllowedOrigin(origin: string | undefined): boolean`
  - `parseBridgeBody(raw: string): BridgePayload`
  - `receiveToken(options: { port: number; host?: string; timeoutMs: number; onListening?: (port: number) => void }): Promise<BridgePayload>`

**安全模型（写进代码注释）：** 任意网页都能向 `http://127.0.0.1:<port>` 发起跨域 POST——CORS 只挡读响应，不挡请求本身。因此必须校验 `Origin`：浏览器不允许网页伪造该头，只有扩展的 `chrome-extension://` 来源能通过。叠加「仅监听回环地址 + 一次性接收 + 超时自动退出 + 仅在用户主动运行时开启」，风险与收益相称。

- [ ] **Step 1: 写失败测试**

`packages/cli/src/io/__tests__/bridge-server.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  type BridgePayload,
  isAllowedOrigin,
  parseBridgeBody,
  receiveToken
} from '../bridge-server';

const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

function post(port: number, body: string, origin: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body
  });
}

/** Starts a receiver on an ephemeral port and hands the port to `run`. */
async function withServer(
  run: (port: number) => Promise<void>
): Promise<Promise<BridgePayload>> {
  let resolvePort!: (port: number) => void;
  const portReady = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });
  const received = receiveToken({
    port: 0,
    timeoutMs: 5_000,
    onListening: resolvePort
  });
  await run(await portReady);
  return received;
}

describe('isAllowedOrigin', () => {
  it('accepts a chrome extension origin', () => {
    expect(isAllowedOrigin(EXT_ORIGIN)).toBe(true);
  });

  it('rejects web page origins and a missing header', () => {
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1:7623')).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
  });
});

describe('parseBridgeBody', () => {
  it('accepts a payload carrying lanhuToken', () => {
    expect(parseBridgeBody('{"lanhuToken":"sid=FAKE"}')).toEqual({
      lanhuToken: 'sid=FAKE'
    });
  });

  it('keeps an optional ddsToken', () => {
    expect(
      parseBridgeBody('{"lanhuToken":"sid=FAKE","ddsToken":"dds=FAKE"}')
    ).toEqual({ lanhuToken: 'sid=FAKE', ddsToken: 'dds=FAKE' });
  });

  it('rejects malformed json', () => {
    expect(() => parseBridgeBody('not json')).toThrow();
  });

  it('rejects a payload without lanhuToken', () => {
    expect(() => parseBridgeBody('{"foo":1}')).toThrow();
  });

  it('rejects a token that is not a cookie pair', () => {
    expect(() => parseBridgeBody('{"lanhuToken":"nocookie"}')).toThrow();
  });
});

describe('receiveToken', () => {
  it('accepts one POST from an extension origin and resolves', async () => {
    const received = await withServer(async (port) => {
      const response = await post(
        port,
        JSON.stringify({ lanhuToken: 'sid=FAKE' }),
        EXT_ORIGIN
      );
      expect(response.status).toBe(200);
    });
    await expect(received).resolves.toEqual({ lanhuToken: 'sid=FAKE' });
  });

  it('answers the CORS preflight', async () => {
    const received = await withServer(async (port) => {
      const preflight = await fetch(`http://127.0.0.1:${port}/token`, {
        method: 'OPTIONS',
        headers: { origin: EXT_ORIGIN }
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(
        EXT_ORIGIN
      );
      await post(port, JSON.stringify({ lanhuToken: 'sid=FAKE' }), EXT_ORIGIN);
    });
    await expect(received).resolves.toEqual({ lanhuToken: 'sid=FAKE' });
  });

  it('rejects a POST from a web page origin with 403 and keeps listening', async () => {
    const received = await withServer(async (port) => {
      const denied = await post(
        port,
        JSON.stringify({ lanhuToken: 'sid=EVIL' }),
        'https://evil.example'
      );
      expect(denied.status).toBe(403);
      await post(port, JSON.stringify({ lanhuToken: 'sid=FAKE' }), EXT_ORIGIN);
    });
    await expect(received).resolves.toEqual({ lanhuToken: 'sid=FAKE' });
  });

  it('rejects a bad payload with 400 and keeps listening', async () => {
    const received = await withServer(async (port) => {
      const bad = await post(port, '{"foo":1}', EXT_ORIGIN);
      expect(bad.status).toBe(400);
      await post(port, JSON.stringify({ lanhuToken: 'sid=FAKE' }), EXT_ORIGIN);
    });
    await expect(received).resolves.toEqual({ lanhuToken: 'sid=FAKE' });
  });

  it('rejects with TOKEN_MISSING after the timeout', async () => {
    await expect(
      receiveToken({ port: 0, timeoutMs: 60 })
    ).rejects.toMatchObject({ code: 'TOKEN_MISSING' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/cli/src/io/__tests__/bridge-server.spec.ts`
Expected: FAIL — `Failed to resolve import "../bridge-server"`

- [ ] **Step 3: 实现接收端**

`packages/cli/src/io/bridge-server.ts`：

```ts
// One-shot loopback receiver for the browser extension's "发送 cookies 到本机".
//
// Threat model: any web page can POST cross-origin to 127.0.0.1 — CORS only
// blocks *reading* the reply, not sending the request. Browsers refuse to let
// pages forge `Origin`, so requiring a chrome-extension:// origin is what
// actually keeps a drive-by page from writing junk into the user's config.
// Loopback-only binding, single-shot acceptance and a hard timeout bound the
// exposure further.

import { createServer } from 'node:http';
import { LanhuError } from '@lanhu-context/core';

const MAX_BODY_BYTES = 64 * 1024;

export interface BridgePayload {
  lanhuToken: string;
  ddsToken?: string;
}

export interface ReceiveTokenOptions {
  port: number;
  host?: string;
  timeoutMs: number;
  /** Receives the bound port; needed when `port` is 0 (tests). */
  onListening?: (port: number) => void;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  return typeof origin === 'string' && origin.startsWith('chrome-extension://');
}

export function parseBridgeBody(raw: string): BridgePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LanhuError('USAGE_ERROR', 'Bridge payload is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new LanhuError('USAGE_ERROR', 'Bridge payload must be a JSON object');
  }

  const record = parsed as Record<string, unknown>;
  const lanhuToken = record.lanhuToken;
  if (typeof lanhuToken !== 'string' || !lanhuToken.includes('=')) {
    throw new LanhuError(
      'USAGE_ERROR',
      'Bridge payload must carry lanhuToken as a Cookie header value'
    );
  }

  const ddsToken = record.ddsToken;
  return {
    lanhuToken,
    ...(typeof ddsToken === 'string' && ddsToken ? { ddsToken } : {})
  };
}

export function receiveToken(
  options: ReceiveTokenOptions
): Promise<BridgePayload> {
  const host = options.host ?? '127.0.0.1';

  return new Promise<BridgePayload>((resolve, reject) => {
    let settled = false;

    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => settle());
    };

    const server = createServer((req, res) => {
      const origin = req.headers.origin;
      const cors: Record<string, string> = isAllowedOrigin(origin)
        ? {
            'access-control-allow-origin': origin as string,
            'access-control-allow-headers': 'content-type',
            'access-control-allow-methods': 'POST, OPTIONS',
            vary: 'Origin'
          }
        : {};

      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      if (req.method !== 'POST' || !req.url?.startsWith('/token')) {
        res.writeHead(404, cors);
        res.end();
        return;
      }
      if (!isAllowedOrigin(origin)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'origin not allowed' }));
        return;
      }

      let body = '';
      let aborted = false;
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
          aborted = true;
          res.writeHead(413, cors);
          res.end();
          req.destroy();
        }
      });
      req.on('end', () => {
        if (aborted) return;
        let payload: BridgePayload;
        try {
          payload = parseBridgeBody(body);
        } catch {
          // Keep listening: one malformed post should not strand the user.
          res.writeHead(400, { ...cors, 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid payload' }));
          return;
        }
        res.writeHead(200, { ...cors, 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        finish(() => resolve(payload));
      });
    });

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new LanhuError(
            'TOKEN_MISSING',
            '等待浏览器扩展发送 Cookie 超时，未写入任何凭据',
            {
              hint: '在蓝湖页面右键点击「发送 cookies 到本机」，或改用 `lanhu auth set`'
            }
          )
        )
      );
    }, options.timeoutMs);
    timer.unref?.();

    server.on('error', (error) => {
      finish(() =>
        reject(
          new LanhuError(
            'IO_WRITE_FAILED',
            `无法在 ${host}:${options.port} 上监听：${error.message}`,
            {
              cause: error,
              hint: '换一个端口：`lanhu auth listen --port 7624`'
            }
          )
        )
      );
    });

    server.listen(options.port, host, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        options.onListening?.(address.port);
      }
    });
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run packages/cli/src/io/__tests__/bridge-server.spec.ts`
Expected: 12 tests PASS

- [ ] **Step 5: 加 `listen` 子命令**

在 `packages/cli/src/commands/auth.ts` 的 import 区加：

```ts
import { receiveToken } from '../io/bridge-server';
```

在 `authTestCommand` 定义之后、`export const authCommand` 之前插入：

```ts
// Must match DEFAULT_BRIDGE_PORT in the browser extension.
const DEFAULT_BRIDGE_PORT = 7623;

const authListenCommand = defineCommand({
  meta: {
    name: 'listen',
    description: [
      '在 127.0.0.1 上一次性接收浏览器扩展发来的 Cookie 并写入用户级配置（0600）。',
      '只接受来源为 chrome-extension:// 的请求；收到一次或超时后退出。',
      '',
      '示例:',
      '  lanhu auth listen',
      '  lanhu auth listen --port 7624 --timeout 300'
    ].join('\n')
  },
  args: {
    port: {
      type: 'string',
      description: `监听端口（默认 ${DEFAULT_BRIDGE_PORT}，需与扩展常量一致）`,
      default: String(DEFAULT_BRIDGE_PORT)
    },
    timeout: {
      type: 'string',
      description: '等待超时秒数（默认 120）',
      default: '120'
    },
    ...globalArgs
  },
  run: ({ args, rawArgs }) =>
    executeCommand({
      command: 'auth listen',
      kind: 'report',
      args,
      rawArgs,
      preValidate: (parsed) => {
        const port = Number(parsed.port);
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          throw new LanhuError(
            'USAGE_ERROR',
            `--port 必须是 1-65535 的整数，收到 ${parsed.port}`
          );
        }
        const timeout = Number(parsed.timeout);
        if (!Number.isFinite(timeout) || timeout <= 0) {
          throw new LanhuError(
            'USAGE_ERROR',
            `--timeout 必须是正数秒，收到 ${parsed.timeout}`
          );
        }
      },
      handler: async (ctx) => {
        const port = Number(args.port);
        const timeoutMs = Number(args.timeout) * 1000;

        // Progress goes to stderr; stdout carries only the result envelope.
        process.stderr.write(
          [
            `listening  http://127.0.0.1:${port}/token（仅接受 chrome-extension:// 来源）`,
            `           在蓝湖设计稿页面右键点击「发送 cookies 到本机」，${args.timeout}s 内有效`,
            ''
          ].join('\n')
        );

        const payload = await receiveToken({ port, timeoutMs });

        const path = ctx.config.userConfigPath;
        writeUserConfig(path, {
          lanhuToken: payload.lanhuToken,
          ...(payload.ddsToken ? { ddsToken: payload.ddsToken } : {})
        });

        const updated = ['LANHU_TOKEN'];
        if (payload.ddsToken) updated.push('DDS_TOKEN');

        const data = {
          path,
          mode: '0600',
          updated,
          fingerprint: maskSecret(payload.lanhuToken)
        };
        return {
          data,
          render: () =>
            [
              `received ${updated.join(', ')} from browser extension`,
              `saved    ${updated.join(', ')} -> ${path} (mode 0600)`,
              `token    ${data.fingerprint}`
            ].join('\n'),
          summary: ['运行 `lanhu auth test <url>` 验证 token 活性']
        };
      }
    })
});
```

把文件末尾的 `subCommands` 改为：

```ts
  subCommands: {
    set: authSetCommand,
    status: authStatusCommand,
    test: authTestCommand,
    listen: authListenCommand
  }
```

并把 `authCommand` 的 `meta.description` 首行改为：

```ts
      '凭据管理：set（写入用户级配置，0600）/ status（来源 + 掩码指纹）/ test（活性检测）/ listen（接收扩展发来的 Cookie）',
```

- [ ] **Step 6: 验证命令可用**

Run: `pnpm build`
Run: `pnpm vitest run packages/cli`
Expected: 全部 PASS

Run: `pnpm lanhu auth listen --help`
Expected: stdout 显示 listen 的用法与 `--port` / `--timeout`

Run: `pnpm lanhu auth listen --timeout 1; echo "exit=$?"`
Expected: 约 1 秒后输出超时错误，`exit=3`

Run: `pnpm lanhu auth listen --port 0; echo "exit=$?"`
Expected: `exit=2`（USAGE_ERROR）

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/io/bridge-server.ts packages/cli/src/io/__tests__/bridge-server.spec.ts packages/cli/src/commands/auth.ts
git commit -m "feat(cli): add auth listen to receive cookies from the browser extension"
```

---

### Task 9: 端到端联调、文档与发布准备

**Files:**
- Modify: `skills/lanhu-context-cli/SKILL.md`
- Modify: `skills/lanhu-context-cli/references/`（对应命令参考文件）
- Modify: `README.md`
- Create: `ecosystem/browser-extension/README.md`
- Create: `.changeset/<random-name>.md`

- [ ] **Step 1: 端到端联调**

终端 A：

```bash
pnpm lanhu auth listen --timeout 300
```

浏览器：打开蓝湖设计稿 → 右键 → 点「发送 cookies 到本机」

断言：
1. 浏览器 toast 显示「已发送到本机 lanhu auth listen」
2. 终端 A 输出 `received LANHU_TOKEN from browser extension` + `saved ... (mode 0600)` + 掩码指纹（**不得出现明文 Cookie**）
3. 进程退出码为 0

- [ ] **Step 2: 验证写入的凭据可用**

```bash
lanhu auth status
```

Expected: `source` 为 `user-config`，显示掩码指纹

```bash
lanhu auth test "<第一步复制的设计稿链接>"
```

Expected: `ok: true`，退出码 0

- [ ] **Step 3: 验证权限位**

```bash
lanhu auth status --json | jq .
```

先确认 envelope 中用户配置路径的实际字段名，再：

```bash
ls -l ~/.config/lanhu/config.json
```

Expected: `-rw-------`（0600）

- [ ] **Step 4: 验证 Origin 防护**

终端起 `pnpm lanhu auth listen --timeout 60`，然后在**任意非扩展网页**（例如 `https://example.com`）的 Console 里执行：

```js
fetch('http://127.0.0.1:7623/token', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lanhuToken: 'sid=EVIL' })
}).then(r => console.log('status', r.status)).catch(e => console.log('blocked', e.message));
```

Expected: 请求被拒（403 或被 CORS 挡住读取），**终端不写入任何凭据**、继续监听至超时退出（exit 3）。

- [ ] **Step 5: 同步 skills**

在 `skills/lanhu-context-cli/SKILL.md` 的命令表与排障章节补充：

- `lanhu auth listen [--port 7623] [--timeout 120]` —— 一次性接收浏览器扩展发来的 Cookie 并写入用户级配置
- 退出码索引新增：超时 → exit 3（`TOKEN_MISSING`）；端口被占用 → exit 7（`IO_WRITE_FAILED`）；`--port` / `--timeout` 非法 → exit 2（`USAGE_ERROR`）
- 命令示例配真实输出（Cookie 用占位符，只展示掩码指纹）

同步 `skills/lanhu-context-cli/references/` 下对应的命令参考文件。

- [ ] **Step 6: 写扩展 README**

`ecosystem/browser-extension/README.md` 覆盖：

- 安装：`pnpm --filter @lanhu-context/browser-extension build` → `chrome://extensions` 开启开发者模式 → 加载 `dist/`
- 三个菜单项的用途
- 与 `lanhu auth listen` 的配合流程
- 端口修改方式（同时改 `src/shared/constants.ts` 与 `--port`）
- 权限说明：`cookies` + `clipboardWrite`，`host_permissions` 仅限 `lanhuapp.com` 与 `127.0.0.1`
- 安全提示：Cookie 等同账号凭据，勿分享、勿提交
- 最低 Chrome 版本 114

在根 `README.md` 增加一节指向该扩展。

- [ ] **Step 7: 全量校验**

Run: `pnpm lint`
Run: `pnpm typecheck`
Run: `pnpm test`
Run: `pnpm build`
Expected: 全部通过

- [ ] **Step 8: 加 changeset**

Run: `pnpm changeset`

选 `@lanhu-context/cli` 做 minor（新增 `auth listen` 子命令）。`@lanhu-context/browser-extension` 是 private 包，不参与发版。摘要写：`新增 lanhu auth listen：从浏览器扩展一次性接收蓝湖 Cookie 并写入用户级配置`。

- [ ] **Step 9: Commit**

```bash
git add skills README.md ecosystem/browser-extension/README.md .changeset
git commit -m "docs: document auth listen and the lanhu browser extension"
```

---

## 风险与回退

| 风险 | 触发条件 | 应对 |
| --- | --- | --- |
| 蓝湖前端改版导致选择器失效 | 未来某次蓝湖发版 | `injectInto` 在找不到 `.mu-menu-list` 时返回 `false` 而非抛错；按 Task 1 折叠区的「侦察方法留档」重测，更新 `selectors.ts` 与 `NOTES.md`，业务逻辑无需改动 |
| 与现场第三方注入器条目重复 | 用户同时装了带 `⚡MCP` 徽标的那个工具 | 菜单会同时出现「复制选中图层链接」与「复制选中设计稿链接」。本扩展用 `data-lanhu-ext-*` 命名空间隔离，不检测也不移除他人节点；是否停用其一由产品侧决定 |
| 端口 7623 被占用 | 本机有其他服务 | `receiveToken` 的 `server.on('error')` 抛 `IO_WRITE_FAILED`(exit 7) 并提示换端口 |
| 剪贴板 API 被拒 | 文档失焦或权限受限 | `copyText` 已有 `execCommand` 兜底；两条路都失败时 toast 明确提示 |

## Self-Review 记录

- **需求覆盖**：三个菜单项分别由 Task 7 的 `copyDesignUrl` / `copyCookies` / `sendCookies` 实现；「复制 cookies 到本机目录」由「扩展取 Cookie（T5）+ CLI `auth listen` 落盘（T8）」组合满足——浏览器扩展本身无法写任意目录，落盘必须由 CLI 完成。
- **ecosystem 子包 + Vite + TypeScript**：Task 2 全覆盖。
- **实施期不读 bundle**：所有逆向事实已固化在「逆向结论摘要」与 `NOTES.md`；DOM 细节由已完成的 Task 1 真机实测产出 `selectors.ts`，Task 6 的构造代码与测试 fixture 均按实测的 5 层嵌套编写。实施阶段无需也不得打开 `lhcdn.lanhuapp.com.local/`。
- **无图层级表述**：菜单项、URL 构造、测试与文档均只涉及设计稿（tid/pid/image_id），不再读取页面 JS 全局，`world: "MAIN"` content script 与 MAIN↔ISOLATED 消息通道已整体移除。计划中仅存的「图层」字样用于描述宿主自身的菜单项，非本项目功能。
- **类型一致性**：`DesignRef`（T3）、`CookieLike`（T4）、`MenuItemSpec`（含可选 `badge`，T6）、`BackgroundMessage` / `BackgroundReply`（T7）、`BridgePayload`（T8）在定义与消费处签名一致；`DEFAULT_BRIDGE_PORT` 在扩展（T2）与 CLI（T8）中同为 7623；`selectors.ts` 的导出被 T6 的实现与测试同时消费，改选择器不需要改逻辑。
- **错误码**：仅使用既有闭合联合中的 `USAGE_ERROR` / `TOKEN_MISSING` / `IO_WRITE_FAILED`，未新增码，无需改 `errors.ts` 与其表驱动测试。
