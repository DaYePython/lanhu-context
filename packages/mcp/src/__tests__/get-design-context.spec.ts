// Unit tests for the get_design_context tool contract (DESIGN.md §9):
// signature compatibility with upstream lanhu-context-mcp, the degraded
// warnings behavior, and the compatStrict opt-out. The Lanhu API is mocked
// via an injected DesignSourceClient; the MCP wire is exercised for real
// through an in-memory client/server transport pair.

import { Buffer } from 'node:buffer';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type DesignSourceClient,
  enUS,
  LanhuError,
  type SchemaNode,
  zhCN
} from '@lanhu-context/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  type CallToolResult,
  CallToolResultSchema
} from '@modelcontextprotocol/sdk/types.js';
import type { LanhuMcpOptions } from '../get-design-context';
import { createServer } from '../server';

const URL_OK =
  'https://lanhuapp.com/web/#/item/project/detailDetach?tid=t1&pid=p1&image_id=img-12345678';

const SCHEMA: SchemaNode = {
  type: 'div',
  props: { className: 'page', style: { width: 100 } },
  children: [
    {
      type: 'lanhuimage',
      props: { className: 'hero', src: 'https://cdn.example.com/hero.png' },
      children: []
    }
  ]
};

const SKETCH_WITH_TOKEN = {
  artboard: {
    layers: [
      {
        name: 'GradBox',
        type: 'rect',
        ddsOriginFrame: { x: 0, y: 0, width: 100, height: 50 },
        fills: [
          {
            isEnabled: true,
            fillType: 1,
            gradient: {
              from: { x: 0, y: 0 },
              to: { x: 0, y: 1 },
              colorStops: [
                { color: { value: '#fff' }, position: 0 },
                { color: { value: '#000' }, position: 1 }
              ]
            }
          }
        ]
      }
    ]
  }
};

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

interface StubOverrides {
  meta?: Partial<Awaited<ReturnType<DesignSourceClient['getDesignMeta']>>>;
  sketch?: () => Promise<Record<string, unknown>>;
  preview?: () => Promise<Buffer>;
}

function makeStubClient(overrides: StubOverrides = {}): DesignSourceClient {
  return {
    async getDesignMeta(request) {
      return {
        id: request.imageId,
        name: 'Home Screen',
        url: 'https://cdn.example.com/preview.png',
        projectName: 'Demo Project',
        ...overrides.meta
      };
    },
    async getDesignSchemaJson() {
      return SCHEMA;
    },
    async getSketchJson() {
      if (overrides.sketch) return overrides.sketch();
      return SKETCH_WITH_TOKEN;
    },
    async downloadImage() {
      if (overrides.preview) return overrides.preview();
      return PNG_BYTES;
    }
  };
}

interface Harness {
  client: Client;
  close: () => Promise<void>;
}

async function connect(
  options: Partial<LanhuMcpOptions> = {},
  overrides: StubOverrides = {}
): Promise<Harness> {
  const server = createServer({
    lanhuToken: 'unit-test-token',
    client: makeStubClient(overrides),
    ...options
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'unit-test-client', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
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

function textItems(result: CallToolResult): TextItem[] {
  return result.content.filter((c): c is TextItem => c.type === 'text');
}

describe('get_design_context — tool registration (upstream signature)', () => {
  test('registers a single tool with the upstream name, description, and {url} schema', async () => {
    const { client, close } = await connect();
    const { tools } = await client.listTools();
    await close();

    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.name).toBe('get_design_context');
    expect(tool.description).toBe(enUS.TOOL_DESCRIPTION);

    const schema = tool.inputSchema as {
      type: string;
      properties?: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
    expect(schema.type).toBe('object');
    expect(schema.properties?.url?.type).toBe('string');
    expect(schema.properties?.url?.description).toBe(
      enUS.URL_INPUT_DESCRIPTION
    );
    expect(schema.required).toEqual(['url']);
  });

  test('lang zh-CN switches the tool description and url description', async () => {
    const { client, close } = await connect({ lang: 'zh-CN' });
    const { tools } = await client.listTools();
    await close();

    expect(tools[0].description).toBe(zhCN.TOOL_DESCRIPTION);
    const schema = tools[0].inputSchema as {
      properties?: Record<string, { description?: string }>;
    };
    expect(schema.properties?.url?.description).toBe(
      zhCN.URL_INPUT_DESCRIPTION
    );
  });
});

describe('get_design_context — inline mode content structure', () => {
  test('returns [text(HTML), text(mapping), text(tokens), text(guide), image]', async () => {
    const { client, close } = await connect();
    const result = await callTool(client, URL_OK);
    await close();

    expect(result.isError).toBeFalsy();
    expect(result.content.length).toBe(5);

    const texts = textItems(result);
    // HTML first.
    expect(result.content[0].type).toBe('text');
    expect(texts[0].text).toContain('HTML+CSS Code:');
    expect(texts[0].text).toContain('<div');
    // Mapping is its own segment.
    const mapping = texts.find(t => t.text.includes('curl -o'));
    expect(mapping).toBeDefined();
    expect(mapping!.text).not.toContain('<div');
    // Tokens segment.
    const tokens = texts.find(t =>
      t.text.includes('Design Tokens (supplementary reference)')
    );
    expect(tokens).toBeDefined();
    // Guide is the last text item.
    const guide = texts[texts.length - 1];
    expect(guide.text).toContain('HTML+CSS > Design Tokens');
    expect(guide.text).not.toContain('<div');
    // Preview image is strictly last.
    const last = result.content[result.content.length - 1];
    expect(last.type).toBe('image');
    expect((last as { mimeType: string }).mimeType).toBe('image/png');
    expect((last as { data: string }).data).toBe(PNG_BYTES.toString('base64'));
    // No warnings block anywhere on the happy path.
    expect(texts.some(t => t.text.includes('warnings:'))).toBe(false);
  });
});

describe('get_design_context — degraded warnings (behavioral diff vs upstream)', () => {
  test('tokens failure: call still succeeds, warnings block appended to the last text item', async () => {
    const { client, close } = await connect(
      {},
      {
        sketch: async () => {
          throw new LanhuError(
            'SCHEMA_FIELD_MISSING',
            'No json_url in design version'
          );
        }
      }
    );
    const result = await callTool(client, URL_OK);
    await close();

    expect(result.isError).toBeFalsy();
    const texts = textItems(result);
    expect(
      texts.some(t =>
        t.text.includes('Design Tokens (supplementary reference)')
      )
    ).toBe(false);
    const guide = texts[texts.length - 1];
    expect(guide.text).toContain('warnings:');
    expect(guide.text).toContain('TOKENS_UNAVAILABLE (degraded)');
    expect(guide.text).toContain('No json_url in design version');
    // The image (preview succeeded) must remain the last content item.
    expect(result.content[result.content.length - 1].type).toBe('image');
  });

  test('preview failure: no image item, PREVIEW_UNAVAILABLE warning appended', async () => {
    const { client, close } = await connect(
      {},
      {
        preview: async () => {
          throw new LanhuError('UPSTREAM_ERROR', 'HTTP 404 on preview.png');
        }
      }
    );
    const result = await callTool(client, URL_OK);
    await close();

    expect(result.isError).toBeFalsy();
    expect(result.content.every(c => c.type === 'text')).toBe(true);
    const guide = textItems(result).at(-1)!;
    expect(guide.text).toContain('PREVIEW_UNAVAILABLE (degraded)');
    expect(guide.text).toContain('HTTP 404 on preview.png');
  });
});

describe('get_design_context — compatStrict restores upstream all-or-nothing', () => {
  test('tokens failure fails the whole call with isError + STOP text', async () => {
    const { client, close } = await connect(
      { compatStrict: true },
      {
        sketch: async () => {
          throw new LanhuError(
            'SCHEMA_FIELD_MISSING',
            'No json_url in design version'
          );
        }
      }
    );
    const result = await callTool(client, URL_OK);
    await close();

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const text = textItems(result)[0].text;
    // Upstream shape: localized stage error message + STOP instruction.
    expect(text).toContain('Failed to extract design tokens');
    expect(text).toContain('No json_url in design version');
    expect(text).toContain(enUS.ERROR_STOP_INSTRUCTION.trim());
    // No partial artifacts leak through.
    expect(text).not.toContain('<div');
  });

  test('compatStrict with no warnings behaves exactly like the default', async () => {
    const { client, close } = await connect({ compatStrict: true });
    const result = await callTool(client, URL_OK);
    await close();

    expect(result.isError).toBeFalsy();
    expect(result.content.length).toBe(5);
    expect(textItems(result).some(t => t.text.includes('warnings:'))).toBe(
      false
    );
  });
});

describe('get_design_context — files mode', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'lanhu-mcp-files-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('returns resource_link items only; files exist on disk', async () => {
    const { client, close } = await connect({ mode: 'files', outDir });
    const result = await callTool(client, URL_OK);
    await close();

    expect(result.isError).toBeFalsy();
    expect(result.content.length).toBe(2);
    expect(result.content.every(c => c.type === 'resource_link')).toBe(true);

    const links = result.content as Array<{
      uri: string;
      name: string;
      mimeType: string;
    }>;
    expect(links.map(l => l.name)).toEqual(['context.md', 'preview.png']);
    expect(links[0].mimeType).toBe('text/markdown');
    expect(links[1].mimeType).toBe('image/png');
    for (const link of links) {
      expect(link.uri.startsWith('file://')).toBe(true);
      expect(existsSync(fileURLToPath(link.uri))).toBe(true);
    }

    const bundle = readFileSync(fileURLToPath(links[0].uri), 'utf8');
    expect(bundle).toContain('HTML+CSS Code:');
    expect(bundle).toContain('<div');
    expect(bundle).toContain('HTML+CSS > Design Tokens');
    expect(bundle).not.toContain('warnings:');
  });

  test('degraded warnings land at the end of context.md, links stay clean', async () => {
    const { client, close } = await connect(
      { mode: 'files', outDir },
      {
        sketch: async () => {
          throw new Error('sketch fetch exploded');
        }
      }
    );
    const result = await callTool(client, URL_OK);
    await close();

    expect(result.isError).toBeFalsy();
    expect(result.content.every(c => c.type === 'resource_link')).toBe(true);
    const context = result.content[0] as { uri: string };
    const bundle = readFileSync(fileURLToPath(context.uri), 'utf8');
    expect(bundle).toContain('warnings:');
    expect(bundle.trimEnd().endsWith('sketch fetch exploded')).toBe(true);
  });
});

describe('get_design_context — error path (upstream STOP contract)', () => {
  test('invalid URL returns isError + STOP instruction text', async () => {
    const { client, close } = await connect();
    const result = await callTool(client, 'tid=t1&pid=p1');
    await close();

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const text = textItems(result)[0].text;
    expect(text).toContain(enUS.ERROR_STOP_INSTRUCTION.trim());
  });

  test('lang zh-CN localizes the STOP instruction', async () => {
    const { client, close } = await connect({ lang: 'zh-CN' });
    const result = await callTool(client, 'not-a-lanhu-url');
    await close();

    expect(result.isError).toBe(true);
    expect(textItems(result)[0].text).toContain(
      zhCN.ERROR_STOP_INSTRUCTION.trim()
    );
  });
});
