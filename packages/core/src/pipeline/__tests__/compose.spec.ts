// Tests for composeContext(): the composite pipeline with the degraded
// severity model — optional stage failures (tokens / preview / tailwind)
// produce warnings instead of aborting, unlike the upstream MCP behavior.
import { Buffer } from 'node:buffer';
import type { DesignSourceClient } from '../../api/client';
import { LanhuError } from '../../errors';
import type { SchemaNode } from '../../types/index';
import { composeContext } from '../compose';

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

interface StubOverrides {
  meta?: Partial<Awaited<ReturnType<DesignSourceClient['getDesignMeta']>>>;
  schema?: SchemaNode;
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
      return overrides.schema ?? SCHEMA;
    },
    async getSketchJson() {
      if (overrides.sketch) return overrides.sketch();
      return SKETCH_WITH_TOKEN;
    },
    async downloadImage() {
      if (overrides.preview) return overrides.preview();
      return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    }
  };
}

describe('composeContext — happy path', () => {
  test('produces HTML, mapping, tokens, guide, and preview with no warnings', async () => {
    const client = makeStubClient();
    const result = await composeContext({ client, url: URL_OK });

    expect(result.designName).toBe('Home Screen');
    expect(result.projectName).toBe('Demo Project');
    expect(result.imageId).toBe('img-12345678');
    expect(result.warnings).toEqual([]);

    // HTML core artifact
    expect(result.contextBody).toContain('HTML+CSS Code:');
    expect(result.contextBody).toContain('class="page"');
    // slice localization happened
    expect(result.contextBody).toContain('./src/assets/home-screen/icon-1.png');
    expect(result.assetsMapping['./src/assets/home-screen/icon-1.png']).toBe(
      'https://cdn.example.com/hero.png'
    );
    // tokens present
    expect(result.contextBody).toContain(
      'Design Tokens (supplementary reference)'
    );
    expect(result.contextBody).toContain('linear-gradient');
    // guide present
    expect(result.contextBody).toContain('SUPER CRITICAL');
    // preview delivered as image content item
    expect(result.previewBuffer).toBeDefined();
    const imageItem = result.content.find(item => item.type === 'image');
    expect(imageItem).toMatchObject({ mimeType: 'image/png' });
  });

  test('lang zh-CN switches the prompt pack', async () => {
    const client = makeStubClient();
    const result = await composeContext({
      client,
      url: URL_OK,
      options: { lang: 'zh-CN' }
    });
    expect(result.contextBody).toContain('HTML+CSS 代码：');
    expect(result.contextBody).toContain('超关键');
  });

  test('skipSlices keeps remote URLs and produces no mapping', async () => {
    const client = makeStubClient();
    const result = await composeContext({
      client,
      url: URL_OK,
      options: { skipSlices: true }
    });
    expect(result.assetsMapping).toEqual({});
    expect(result.contextBody).toContain('https://cdn.example.com/hero.png');
    expect(result.contextBody).not.toContain('curl -o');
  });

  test('accepts pre-parsed params instead of a URL', async () => {
    const client = makeStubClient();
    const result = await composeContext({
      client,
      params: { teamId: 't1', projectId: 'p1', docId: 'img-abc' }
    });
    expect(result.imageId).toBe('img-abc');
  });
});

describe('composeContext — degraded stages become warnings (key upstream diff)', () => {
  test('tokens failure → TOKENS_UNAVAILABLE warning, HTML still returned', async () => {
    const client = makeStubClient({
      sketch: async () => {
        throw new LanhuError(
          'SCHEMA_FIELD_MISSING',
          'No json_url in design version'
        );
      }
    });

    const result = await composeContext({ client, url: URL_OK });

    expect(result.contextBody).toContain('class="page"');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: 'TOKENS_UNAVAILABLE',
      severity: 'degraded'
    });
    expect(result.warnings[0].message).toContain(
      'No json_url in design version'
    );
    expect(result.contextBody).not.toContain(
      'Design Tokens (supplementary reference)'
    );
  });

  test('preview failure → PREVIEW_UNAVAILABLE warning, HTML still returned', async () => {
    const client = makeStubClient({
      preview: async () => {
        throw new LanhuError('UPSTREAM_ERROR', 'HTTP 404 on preview.png');
      }
    });

    const result = await composeContext({ client, url: URL_OK });

    expect(result.contextBody).toContain('class="page"');
    expect(result.previewBuffer).toBeUndefined();
    expect(result.content.some(item => item.type === 'image')).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: 'PREVIEW_UNAVAILABLE',
      severity: 'degraded'
    });
  });

  test('tokens + preview both failing collects both warnings', async () => {
    const client = makeStubClient({
      sketch: async () => {
        throw new Error('sketch fetch exploded');
      },
      preview: async () => {
        throw new Error('preview fetch exploded');
      }
    });

    const result = await composeContext({ client, url: URL_OK });

    expect(result.warnings.map(w => w.code).sort()).toEqual([
      'PREVIEW_UNAVAILABLE',
      'TOKENS_UNAVAILABLE'
    ]);
    // Core artifact unaffected.
    expect(result.contextBody).toContain('HTML+CSS Code:');
  });

  test('missing preview URL means no download attempt and no warning', async () => {
    const client = makeStubClient({
      meta: { url: undefined },
      preview: async () => {
        throw new Error('should not be called');
      }
    });

    const result = await composeContext({ client, url: URL_OK });
    expect(result.previewBuffer).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  test('empty tokens string adds no Design Tokens section and no warning', async () => {
    const client = makeStubClient({
      sketch: async () => ({ artboard: { layers: [] } })
    });
    const result = await composeContext({ client, url: URL_OK });
    expect(result.contextBody).not.toContain(
      'Design Tokens (supplementary reference)'
    );
    expect(result.warnings).toEqual([]);
  });
});

describe('composeContext — fatal stages still throw', () => {
  test('invalid URL throws a usage-class LanhuError', async () => {
    const client = makeStubClient();
    await expect(
      composeContext({ client, url: 'tid=t1&pid=p1' })
    ).rejects.toMatchObject({ code: 'URL_MISSING_IMAGE_ID', exitClass: 2 });
  });

  test('meta failure aborts the run', async () => {
    const client = makeStubClient();
    client.getDesignMeta = async () => {
      throw new LanhuError('EMPTY_RESULT', 'empty result');
    };
    await expect(composeContext({ client, url: URL_OK })).rejects.toMatchObject(
      { code: 'EMPTY_RESULT', exitClass: 4 }
    );
  });

  test('schema failure aborts the run', async () => {
    const client = makeStubClient();
    client.getDesignSchemaJson = async () => {
      throw new LanhuError(
        'SCHEMA_FIELD_MISSING',
        'Design has no latest_version'
      );
    };
    await expect(composeContext({ client, url: URL_OK })).rejects.toMatchObject(
      { code: 'SCHEMA_FIELD_MISSING', exitClass: 5 }
    );
  });
});
