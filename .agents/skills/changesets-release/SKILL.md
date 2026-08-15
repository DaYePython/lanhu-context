---
name: changesets-release
description: 用 changesets + GitHub Actions 自动发布 npm 包（pnpm monorepo）。当用户要为仓库接入自动发版流程、写 changeset、理解或排查 Version Packages PR、Release 工作流失败（npm 401/ENEEDAUTH、action 不建 PR、HEAD diverged）、或问"怎么发版/怎么升版本号"时使用。不适用于：手改版本号（被 changesets 流程禁止）、非 npm 产物的发布（Docker/静态站点）。
---

# changesets-release：changesets + GitHub Actions 自动发版

流程总览（一图流）：

```text
写代码 + pnpm changeset（生成 .changeset/*.md，跟代码一起 commit）
  → push 到 main
  → Release workflow 触发：changesets/action 发现有 changeset
  → 自动开/更新一个 "Version Packages" PR（升版本号 + 写 CHANGELOG + 回写内部依赖）
  → 人工合并该 PR
  → workflow 再次触发：没有 changeset 了 → 执行 publish-script 发 npm + 打 git tag + 建 GitHub Release
```

版本号永远不手改——由 `changeset version`（在 Version Packages PR 里自动执行）统一升版。

## 一次性接入（新仓库）

```bash
# 1. 安装并初始化（生成 .changeset/config.json）
pnpm add -Dw @changesets/cli
pnpm changeset init
```

2. `.changeset/config.json` 要点（其余保持默认即可）：

```json
{
  "changelog": "@changesets/cli/changelog",
  "access": "public",
  "baseBranch": "main"
}
```

3. 根 package.json 三个脚本：

```json
{
  "scripts": {
    "changeset": "changeset",
    "version-packages": "changeset version",
    "release": "pnpm -r build && changeset publish"
  }
}
```

4. 包侧检查：要发布的包不设 `private`、带 `"publishConfig": {"access": "public"}`；不发布的占位包设 `"private": true`（changesets 自动忽略）；workspace 内部依赖用 `workspace:^`（`changeset version` 会自动替换成真实版本）。

5. 复制 [templates/release.yml](templates/release.yml) 到 `.github/workflows/release.yml`。

6. GitHub 仓库两处配置（都是常见坑，先配好再 push）：
   - Settings → Secrets and variables → Actions → 新建 `NPM_TOKEN`（npmjs.com 生成 Automation/Granular token，需有目标包或 scope 的 publish 权限）；
   - Settings → Actions → General → Workflow permissions：勾选 **Allow GitHub Actions to create and approve pull requests**（不勾则 action 无法创建 Version Packages PR）。

## 日常发版

```bash
# 1. 改完代码后，为本次变更写 changeset（交互选包、选 major/minor/patch、写变更说明）
pnpm changeset
# 非交互场景（CI/Agent）：直接手写 .changeset/<any-name>.md：
# ---
# '@scope/pkg-a': minor
# '@scope/pkg-b': patch
# ---
# 变更说明（会进 CHANGELOG）

# 2. changeset 文件与代码一起 commit、push 到 main

# 3. 查看待发版状态（可选）
pnpm changeset status
# → 列出将被 bump 的包与级别；"No changesets present" 表示没有待发内容，属正常

# 4. 到 GitHub 合并自动出现的 "Version Packages" PR → 合并后自动发 npm
```

semver 约定：修 bug → patch；新命令/新 flag/新字段 → minor；破坏输出契约/退出码/对外签名 → major。

## templates/release.yml 各段在干什么

| 段 | 作用 |
| --- | --- |
| `on.push.branches: [main]` | 只在 main 变更时跑；PR 阶段的检查交给单独的 CI workflow |
| `concurrency` | 同一时刻只跑一个 Release，防止并发发版互踩 |
| `permissions: contents: write, pull-requests: write` | 建 PR、打 tag、发 GitHub Release 所需 |
| `setup-node` 带 `registry-url` | **关键**：会生成读取 `NODE_AUTH_TOKEN` 的 .npmrc——没有它 npm 发布必 401 |
| build/typecheck/test 步骤 | 发版前的质量门；失败则既不开 PR 也不发布 |
| `changesets/action@v2` | 有 changeset → 开/更新 Version Packages PR；没有 → 执行 `publish-script` 发布 |
| `create-github-releases` / `push-git-tags` | 发布成功后自动打 tag（`pkg@x.y.z`）并生成 GitHub Release |
| `env.NODE_AUTH_TOKEN: secrets.NPM_TOKEN` | npm 发布凭据，只在 publish 步骤可见 |

版本配套：`changesets/action@v2` 需要 `@changesets/cli` **v3**（v2 CLI 会不兼容）。

## 排障（按报错索引）

| 报错/现象 | 原因 | 动作 |
| --- | --- | --- |
| `Failed to find where HEAD diverged from main` | 仓库还没有 main 提交（git init 后未 commit），或 CI 浅克隆缺历史 | 先做首次 commit；CI 中给 checkout 配 `fetch-depth: 0` |
| npm publish `401 Unauthorized` / `ENEEDAUTH` | `NODE_AUTH_TOKEN` 没被 npm 读到 | 确认 setup-node 配了 `registry-url`（生成 .npmrc 的前提）；确认 secret 名与 workflow 里一致、token 未过期且有 publish 权限 |
| action 报无权创建 PR（`GitHub Actions is not permitted to create or approve pull requests`） | 仓库默认关闭了该权限 | Settings → Actions → General → 勾选 Allow GitHub Actions to create and approve pull requests |
| workflow 绿了但没发包、也没开 PR | 没有 changeset 文件 | `pnpm changeset status` 确认；补写 changeset 再 push |
| 某个包一直不被发布 | 该包 `private: true`（changesets 忽略）或不在 changeset 里 | 确认包的 private/publishConfig 与 changeset 覆盖范围 |
| Version Packages PR 里版本/依赖不对 | 手改过版本号，或内部依赖没用 `workspace:^` | 回退手改；内部依赖统一 `workspace:^`，让 `changeset version` 回写 |
| 占位/半成品包被发出去了 | 包过早去掉 private | 未就绪的包保持 `private: true`，就绪时再开放并补 changeset |

## 边界

- Release workflow 只做发版；lint/test 的 PR 门禁放独立 CI workflow（避免发版被无关矩阵拖慢，本模板已内置最小质量门）。
- token 安全：`NPM_TOKEN` 只放 GitHub Secrets，绝不进代码、日志或 changeset 文件。
