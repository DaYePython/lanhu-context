// stdio integration test for the `lanhu-context-mcp` bin (DESIGN.md §11 M4
// DoD): spawns the built bin, connects a real MCP client over stdio, and asserts the
// get_design_context return structure is signature-compatible with upstream
// lanhu-context-mcp (same assertions as its stdio integration spec).
//
// Opt-in only — requires the real Lanhu APIs:
//   pnpm -r build && RUN_INTEGRATION=1 pnpm vitest run mcp.stdio.integration
//
// Reads LANHU_TOKEN / DDS_TOKEN / LANHU_TEST_URL from process.env or the
// repo-root .env.local. Tokens are passed to the child via env only.

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  type CallToolResult,
  CallToolResultSchema
} from '@modelcontextprotocol/sdk/types.js';

const BIN = fileURLToPath(new URL('../../dist/main.js', import.meta.url));

function loadEnvLocal(): Record<string, string> {
  const envPath = fileURLToPath(
    new URL('../../../../.env.local', import.meta.url)
  );
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const enabled = process.env.RUN_INTEGRATION === '1';
const envFile = enabled ? loadEnvLocal() : {};
const lanhuToken = process.env.LANHU_TOKEN || envFile.LANHU_TOKEN || '';
const ddsToken = process.env.DDS_TOKEN || envFile.DDS_TOKEN || '';
const testUrl = process.env.LANHU_TEST_URL || envFile.LANHU_TEST_URL || '';

interface Harness {
  client: Client;
  close: () => Promise<void>;
}

// Spawn the built CLI as an MCP stdio server. Args are passed as an array
// (no shell); the token travels via child env only.
async function setup(extraArgs: string[] = [], cwd?: string): Promise<Harness> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, '--stdio', ...extraArgs],
    cwd: cwd ?? workDir,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      LANHU_TOKEN: lanhuToken,
      ...(ddsToken ? { DDS_TOKEN: ddsToken } : {})
    },
    stderr: 'pipe'
  });
  const stderrChunks: string[] = [];
  transport.stderr?.on('data', chunk => {
    stderrChunks.push(String(chunk));
  });

  const client = new Client({
    name: 'lanhu-mcp-integration-client',
    version: '0.0.0'
  });
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close();
    const stderrOutput = stderrChunks.join('').trim();
    if (stderrOutput) {
      throw new Error(
        `Failed to start \`lanhu-context-mcp --stdio\`:\n${stderrOutput}`
      );
    }
    throw error;
  }

  return {
    client,
    close: async () => {
      await client.close();
    }
  };
}

function callTool(client: Client, url: string): Promise<CallToolResult> {
  return client.request(
    {
      method: 'tools/call',
      params: { name: 'get_design_context', arguments: { url } }
    },
    CallToolResultSchema
  );
}

type TextItem = { type: 'text'; text: string };

let workDir = tmpdir();

describe.runIf(enabled)(
  'lanhu-context-mcp — stdio integration (RUN_INTEGRATION=1)',
  () => {
    beforeAll(() => {
      expect(
        existsSync(BIN),
        'packages/cli/dist/main.js missing — run `pnpm -r build` first'
      ).toBe(true);
      expect(lanhuToken, 'LANHU_TOKEN missing in env/.env.local').toBeTruthy();
      expect(testUrl, 'LANHU_TEST_URL missing in env/.env.local').toBeTruthy();
      workDir = mkdtempSync(join(tmpdir(), 'lanhu-mcp-integration-'));
    });

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    test('inline mode returns the upstream multi-segment content array', async () => {
      const { client, close } = await setup();
      const result = await callTool(client, testUrl);
      await close();

      expect(result.isError).toBeFalsy();
      expect(result.content.length).toBeGreaterThanOrEqual(2);

      // HTML segment first.
      const htmlItem = result.content[0];
      expect(htmlItem.type).toBe('text');
      const htmlText = (htmlItem as TextItem).text;
      expect(htmlText).toMatch(/HTML\+(CSS|Tailwind)/);
      expect(htmlText).toContain('<div');

      // Guide tail marker in the last text segment; no HTML leakage.
      const texts = result.content.filter(
        (c): c is TextItem => c.type === 'text'
      );
      const guide = texts[texts.length - 1];
      expect(guide.text).toContain('HTML+CSS > Design Tokens');
      expect(guide.text).not.toContain('<div');

      // Mapping (when present) is its own segment with curl commands.
      const mapping = texts.find(t => t.text.includes('curl -o'));
      if (mapping) {
        expect(mapping.text).not.toContain('<div');
      }

      // Preview image (when present) is strictly the last content item.
      const images = result.content.filter(c => c.type === 'image');
      if (images.length > 0) {
        const last = result.content[result.content.length - 1];
        expect(last.type).toBe('image');
        expect((last as { mimeType: string }).mimeType).toBe('image/png');
      }
    }, 60_000);

    test('files mode returns only resource_links pointing to real files', async () => {
      const outDir = join(workDir, '.lanhu.local');
      const { client, close } = await setup([
        '--mode',
        'files',
        '--out-dir',
        outDir
      ]);
      const result = await callTool(client, testUrl);
      await close();

      expect(result.isError).toBeFalsy();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content.every(c => c.type === 'resource_link')).toBe(true);

      const links = result.content as Array<{
        uri: string;
        name: string;
        mimeType: string;
      }>;
      const names = links.map(l => l.name);
      expect(names).toContain('context.md');
      for (const link of links) {
        const info = statSync(fileURLToPath(link.uri));
        expect(info.isFile()).toBe(true);
        expect(info.size).toBeGreaterThan(0);
      }

      // context.md bundles the same blocks inline mode emits.
      const ctx = links.find(l => l.name === 'context.md');
      const bundle = readFileSync(fileURLToPath(ctx!.uri), 'utf8');
      expect(bundle).toMatch(/HTML\+(CSS|Tailwind) Code:/);
      expect(bundle).toContain('<div');
      expect(bundle).toContain('HTML+CSS > Design Tokens');
    }, 60_000);

    test('bad URL returns isError with the STOP instruction (protocol-level success)', async () => {
      const { client, close } = await setup();
      const result = await callTool(client, 'tid=only-a-team-id');
      await close();

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect((result.content[0] as TextItem).text).toContain('STOP');
    }, 60_000);
  }
);
