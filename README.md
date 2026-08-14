# lanhu-context

> Turn Lanhu (蓝湖) design URLs into AI-ready front-end implementation context — a pipeline CLI built for AI agents and shell automation, with an MCP compatibility layer.

[English](README.md) | [简体中文](README.zh.md)

`lanhu-context` takes a `lanhuapp.com` design detail URL and breaks the "design → code" flow into small, composable commands: parse IDs, fetch metadata, pull the DDS schema, render HTML+CSS (optionally Tailwind v3/v4), extract design tokens, download slice assets, grab the preview image, or assemble everything into one `context.md` for an AI agent to implement.

## Highlights

- **Atomic, pipeable commands** — `parse` / `meta` / `schema` / `html` / `tokens` / `assets` / `preview` / `context`, each does one thing; stdout carries data only.
- **Machine-readable by default** — `--json` gives a uniform envelope (`ok` / `data` / `error` / `warnings` / `meta`) plus classified exit codes; errors carry `{code, severity, message, hint}`.
- **Graded severity** — optional stages (tokens, preview) failing degrade with warnings instead of killing the run (`fatal` / `degraded` / `notice`).
- **Idempotent outputs** — re-runs compare file content and report `written` / `skipped` / `overwritten`; `--force` to override.
- **Credential tooling** — `lanhu auth set/test` and `lanhu doctor` for token (browser Cookie) management and diagnosis; tokens are never echoed.
- **MCP compatibility** — `lanhu mcp` serves the upstream `lanhu-context-mcp` `get_design_context` tool contract over stdio or streamable HTTP.
- **Agent skills included** — ready-made skills under [skills/](skills/) teach Claude Code (and other agents) how to drive the CLI and the MCP server.

## Install

### Option 1: hand it to an AI agent (recommended)

Paste the following paragraph into any AI client that supports this repo (Codex / Claude Code / Cursor / Hermes / Trae / Qoder, etc.) and let it handle both the CLI install and the skill setup:

```text
Please install lanhu-context (https://github.com/DaYePython/lanhu-context) for me:
1. npm i -g @lanhu-context/cli, then run `lanhu doctor` until it exits 0 (use `lanhu auth set` to configure LANHU_TOKEN if credentials fail);
2. Fetch skills/lanhu-context-cli/SKILL.md from the repo and install it in your own skill/rule/plugin format (e.g. Claude Code skills dir, Codex AGENTS.md, Cursor .cursor/rules);
3. Report back the doctor result and where the skill was installed.
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

To teach your agent how to drive the CLI, install the bundled skills with [find-skills](https://github.com/vercel-labs/skills):

```bash
npx skills add DaYePython/lanhu-context
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

For MCP clients: run `lanhu mcp --stdio` (or `--http`) and register it in the client; migration from the upstream `lanhu-context-mcp` npm package is drop-in — see [skills/lanhu-context-mcp/SKILL.md](skills/lanhu-context-mcp/SKILL.md).

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
