# lanhu-context

> Turn Lanhu (蓝湖) design URLs into AI-ready front-end implementation context — a pipeline CLI built for AI agents and shell automation, with an MCP compatibility layer.

[English](README.md) | [简体中文](README.zh.md)

`lanhu-context` takes a `lanhuapp.com` design detail URL and breaks the "design → code" flow into small, composable commands: parse IDs, fetch metadata, pull the DDS schema, render HTML+CSS (optionally Tailwind v3/v4), extract design tokens, download slice assets, grab the preview image, or assemble everything into one `context.md` for an AI agent to implement.

## Highlights

- **Atomic, pipeable commands** — `parse` / `meta` / `schema` / `html` / `tokens` / `assets` / `preview` / `context`, each does one thing; stdout carries data only.
- **Machine-readable by default** — `--json` gives a uniform envelope (`ok` / `data` / `error` / `warnings` / `meta`) plus classified exit codes; errors carry `{code, severity, message, hint}`.
- **Graded severity** — optional stages (tokens, preview) failing degrade with warnings instead of killing the run (`fatal` / `degraded` / `notice`).
- **Idempotent outputs** — re-runs compare file content and report `written` / `skipped` / `overwritten`; `--force` to override.
- **Credential tooling** — `lanhu auth set/test/listen` and `lanhu doctor` for token (browser Cookie) management and diagnosis; tokens are never echoed. A companion [browser extension](ecosystem/browser-extension) copies the design URL / cookies from Lanhu's own context menu and can push them straight to `lanhu auth listen`.
- **MCP compatibility** — the standalone `lanhu-context-mcp` bin (npm `@lanhu-context/mcp`) serves the upstream `lanhu-context-mcp` `get_design_context` tool contract over stdio or streamable HTTP.
- **Agent skills included** — ready-made skills under [skills/](skills/) teach Claude Code (and other agents) how to drive the CLI and the MCP server.

## Install

### Option 1: hand it to an AI agent (recommended)

Pick a scope, then paste the whole paragraph into any AI client that supports this repo (Codex / Claude Code / Cursor / Hermes / Trae / Qoder, etc.) and let it handle both the CLI install and the skill setup.

**Global install** (CLI available everywhere, skill goes into the user-level/global skills directory, shared by all projects):

```text
Please install lanhu-context globally for me (do NOT clone any source repository):
1. npm i -g @lanhu-context/cli, then run `lanhu doctor` until it exits 0 (use `lanhu auth set` to configure LANHU_TOKEN if credentials fail);
2. Run `npx -y skills add dayepython/lanhu-context -s lanhu-context-cli -g -y` to install the skill globally; if that doesn't apply to you, install the lanhu-context-cli skill into your own global skill/rule directory (e.g. Claude Code ~/.claude/skills, Codex ~/.codex/AGENTS.md);
3. Report back the doctor result and where the skill was installed.
```

**Project-level install** (CLI as a devDependency of the current project, skill scoped to this project; the CLI is not on the global PATH, so every command needs a prefix):

```text
Please install lanhu-context inside the current project (do NOT clone any source repository, do NOT install globally):
1. npm i -D @lanhu-context/cli; from then on run every lanhu command with a prefix: `npx lanhu <command>` (or wrap them in package.json scripts and invoke via npm run);
2. Run `npx lanhu doctor` until it exits 0 (use `npx lanhu auth set` to configure LANHU_TOKEN, stored in the project .env.local — make sure it is gitignored);
3. Run `npx -y skills add dayepython/lanhu-context -s lanhu-context-cli -y` to install the skill (project scope is the default); if that doesn't apply to you, install the lanhu-context-cli skill into this project's skill/rule directory (e.g. .claude/skills, .cursor/rules) and note in the skill usage that commands need the `npx lanhu` prefix;
4. Report back the doctor result and where the skill was installed.
```

### Option 2: manual install

Install the CLI and pass the self-check:

```bash
npm i -g @lanhu-context/cli
lanhu doctor        # self-check env/credentials, exit 0 = ready
```

If `doctor` reports a credential problem, configure your Lanhu credential (`LANHU_TOKEN` is the full browser Cookie header from a logged-in lanhuapp.com session) and re-run it:

```bash
lanhu auth set          # reads token from stdin, keeps it off the command line
lanhu auth test "$URL"  # exit 0 = token works
```

Prefer one-click login? Install the companion [browser extension](ecosystem/browser-extension) (prebuilt zip on the [GitHub Releases](https://github.com/DaYePython/lanhu-context/releases) page, or build from source — see [ecosystem/browser-extension/README.md](ecosystem/browser-extension/README.md)), then start the one-shot receiver — via npx this works even before the CLI is installed:

```bash
lanhu auth listen
# no global install? log in via npx:
npx -y -p @lanhu-context/cli lanhu auth listen
```

Right-click "发送 cookies 到本机" (send cookies to this machine) on any Lanhu design page before the timeout (120 s by default) — the receiver only accepts requests originating from the extension (`chrome-extension://` origin), listens on 127.0.0.1 once, and stores the credential with mode 0600.

To teach your agent how to drive the CLI, install the bundled lanhu-context-cli skill with [find-skills](https://github.com/vercel-labs/skills) (project-scoped by default; add `-g` for a global install and `-a <agent>` to pick target agents — agents that don't support global installs are skipped with a ✗):

```bash
npx -y skills add \
  dayepython/lanhu-context \
  -s lanhu-context-cli \
  -y
```

## Quick start

Generate implementation context for a design:

```bash
lanhu context "https://lanhuapp.com/web/#/item/project/detailDetach?tid=...&pid=...&image_id=..." \
  --json --out-dir .lanhu.local
```

This writes `<out-dir>/<design-name>-<imageId8>/{context.md, preview.png}` — HTML+CSS code, a slice-asset mapping, design tokens, and an implementation guide. Download slices into your project with:

```bash
lanhu assets "$URL" --download -o src/assets/my-page --json
```

Prefer atomic commands when you only need part of the pipeline, e.g. `lanhu html "$URL" --skip-slices` for layout only, or `lanhu tokens "$URL"` for tokens only.

For MCP clients: run `npx -y @lanhu-context/mcp --stdio` (bin `lanhu-context-mcp`, `--http` also supported) and register it in the client; migration from the upstream `lanhu-context-mcp` npm package is drop-in — see [skills/lanhu-context-mcp/SKILL.md](skills/lanhu-context-mcp/SKILL.md). The matching agent skill installs with `npx -y skills add dayepython/lanhu-context -s lanhu-context-mcp -y` (add `-g` for a global install).

## Packages

| Package | Description |
| --- | --- |
| [`@lanhu-context/cli`](packages/cli) | The `lanhu` / `lanhu-context` binary: all pipeline commands, `auth`, `doctor`, `mcp` |
| [`@lanhu-context/core`](packages/core) | Pure logic: URL parsing, Lanhu API client, schema→HTML, design tokens, context pipeline |
| [`@lanhu-context/mcp`](packages/mcp) | MCP compatibility layer exposing `get_design_context` on top of core |

## Development

Requires Node `^20.19.0 || >=22.12.0` and pnpm 10.

```bash
pnpm install
pnpm build       # build all packages
pnpm test        # vitest
pnpm typecheck
pnpm lint        # biome
```

See [DESIGN.md](DESIGN.md) for the full architecture (pipeline stages, error model, exit codes, config layering).

## License

[MIT](LICENSE)

## Special thanks

This project grew out of, and keeps tool-contract compatibility with, [refinist/lanhu-context-mcp](https://github.com/refinist/lanhu-context-mcp) — huge thanks to its author for the original end-to-end design-to-context pipeline that made this CLI possible. ❤️
