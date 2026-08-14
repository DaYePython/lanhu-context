// Unit tests for LanhuClient — the ofetch rewrite of the upstream axios
// clients. A mock fetch implementation is injected so no network is used.
import { Buffer } from 'node:buffer';
import { LanhuError } from '../../errors';
import type { LanhuDesignRequest } from '../../types/index';
import { LanhuClient } from '../client';

interface RecordedCall {
  url: string;
  headers: Headers;
}

type Responder = (url: URL) => Response | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function makeFetchMock(responder: Responder): {
  fetch: typeof globalThis.fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push({ url: request.url, headers: request.headers });
    const response = responder(url);
    if (!response) {
      throw new Error(`fetch mock: unexpected URL ${request.url}`);
    }
    return response;
  }) as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

const REQUEST: LanhuDesignRequest = {
  teamId: 'team-1',
  projectId: 'project-1',
  imageId: 'img-1'
};

function makeClient(responder: Responder, options: { ddsToken?: string } = {}) {
  const { fetch, calls } = makeFetchMock(responder);
  const client = new LanhuClient({
    lanhuToken: 'lanhu-token',
    ddsToken: options.ddsToken,
    timeout: 1234,
    fetch
  });
  return { client, calls };
}

describe('LanhuClient — construction', () => {
  test('throws TOKEN_MISSING without a lanhuToken', () => {
    try {
      new LanhuClient({ lanhuToken: '' });
      throw new Error('expected constructor to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(LanhuError);
      expect((error as LanhuError).code).toBe('TOKEN_MISSING');
      expect((error as LanhuError).exitClass).toBe(3);
    }
  });
});

describe('LanhuClient — headers and routing', () => {
  test('main client sends browser-masquerading headers with the Cookie token', async () => {
    const { client, calls } = makeClient(url => {
      if (url.pathname === '/api/project/image') {
        return jsonResponse({
          code: '00000',
          result: {
            name: 'Init Home',
            image_url: 'https://example.com/init.png',
            project_name: 'Init Project'
          }
        });
      }
      return undefined;
    });

    await expect(client.getDesignMeta(REQUEST)).resolves.toEqual({
      id: 'img-1',
      name: 'Init Home',
      url: 'https://example.com/init.png',
      projectName: 'Init Project',
      versions: { count: 0, latestHasSketchJson: false }
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toContain('https://lanhuapp.com/api/project/image');
    expect(call.url).toContain('team_id=team-1');
    expect(call.url).toContain('project_id=project-1');
    expect(call.url).toContain('image_id=img-1');
    expect(call.url).toContain('dds_status=1');
    expect(call.headers.get('cookie')).toBe('lanhu-token');
    expect(call.headers.get('referer')).toBe('https://lanhuapp.com/web/');
    expect(call.headers.get('request-from')).toBe('web');
    expect(call.headers.get('real-path')).toBe('/item/project/detailDetach');
    expect(call.headers.get('sec-ch-ua')).toContain('Chromium');
    expect(call.headers.get('user-agent')).toContain('Mozilla/5.0');
  });

  test('dds client sends its own Cookie plus the fixed Basic authorization', async () => {
    const { client, calls } = makeClient(
      url => {
        if (url.pathname === '/api/project/multi_info') {
          return jsonResponse({
            code: '00000',
            result: { images: [{ id: 'img-1', latest_version: 'v-1' }] }
          });
        }
        if (url.pathname === '/api/dds/image/store_schema_revise') {
          return jsonResponse({
            code: '00000',
            data: { data_resource_url: 'https://dds.lanhuapp.com/schema.json' }
          });
        }
        if (url.pathname === '/schema.json') {
          return jsonResponse({ root: { id: 'schema-1' } });
        }
        return undefined;
      },
      { ddsToken: 'dds-token' }
    );

    await expect(client.getDesignSchemaJson(REQUEST)).resolves.toEqual({
      root: { id: 'schema-1' }
    });

    expect(calls.map(c => new URL(c.url).pathname)).toEqual([
      '/api/project/multi_info',
      '/api/dds/image/store_schema_revise',
      '/schema.json'
    ]);
    const ddsCall = calls[1];
    expect(new URL(ddsCall.url).searchParams.get('version_id')).toBe('v-1');
    expect(ddsCall.headers.get('cookie')).toBe('dds-token');
    expect(ddsCall.headers.get('authorization')).toBe('Basic dW5kZWZpbmVkOg==');
    expect(ddsCall.headers.get('referer')).toBe('https://dds.lanhuapp.com/');
  });

  test('ddsToken defaults to lanhuToken when omitted', async () => {
    const { client, calls } = makeClient(url => {
      if (url.pathname === '/api/project/multi_info') {
        return jsonResponse({
          code: '00000',
          result: { images: [{ id: 'img-1', latest_version: 'v-9' }] }
        });
      }
      if (url.pathname === '/api/dds/image/store_schema_revise') {
        return jsonResponse({
          code: '00000',
          data: { data_resource_url: '/s.json' }
        });
      }
      if (url.pathname === '/s.json') {
        return jsonResponse({ ok: true });
      }
      return undefined;
    });

    await client.getDesignSchemaJson(REQUEST);
    expect(calls[1].headers.get('cookie')).toBe('lanhu-token');
  });
});

describe('LanhuClient — envelope errors (HTTP 200 + null payload)', () => {
  test('getDesignMeta surfaces EMPTY_RESULT with code/msg detail', async () => {
    let call = 0;
    const bodies = [
      { code: '10009', msg: 'Image not exist', result: null },
      { code: '10009', result: null },
      { result: null }
    ];
    const { client } = makeClient(url => {
      if (url.pathname === '/api/project/image') {
        return jsonResponse(bodies[call++]);
      }
      return undefined;
    });

    await expect(client.getDesignMeta(REQUEST)).rejects.toThrow(
      'Lanhu API /api/project/image returned empty result (10009 Image not exist). ' +
        'Verify the Lanhu URL is complete (tid/pid/image_id must be full ids, not truncated) and LANHU_TOKEN is valid.'
    );
    await expect(client.getDesignMeta(REQUEST)).rejects.toThrow(
      'Lanhu API /api/project/image returned empty result (10009)'
    );
    await expect(client.getDesignMeta(REQUEST)).rejects.toMatchObject({
      code: 'EMPTY_RESULT',
      exitClass: 4,
      retryable: false
    });
  });

  test('getDesignSchemaJson classifies version lookup failures', async () => {
    const multiInfoBodies = [
      { code: '10001', msg: 'bad request' },
      { code: '00000', result: { images: [{ id: 'img-1' }] } },
      {
        code: '00000',
        result: { images: [{ id: 'other', latest_version: 'v-2' }] }
      },
      { code: '00000', result: {} }
    ];
    let call = 0;
    const { client } = makeClient(url => {
      if (url.pathname === '/api/project/multi_info') {
        return jsonResponse(multiInfoBodies[call++]);
      }
      return undefined;
    });

    await expect(client.getDesignSchemaJson(REQUEST)).rejects.toMatchObject({
      code: 'EMPTY_RESULT',
      message: expect.stringContaining(
        'Lanhu API /api/project/multi_info returned empty result (10001 bad request)'
      )
    });
    await expect(client.getDesignSchemaJson(REQUEST)).rejects.toMatchObject({
      code: 'SCHEMA_FIELD_MISSING',
      message: 'Design has no latest_version',
      exitClass: 5
    });
    await expect(client.getDesignSchemaJson(REQUEST)).rejects.toMatchObject({
      code: 'DESIGN_NOT_FOUND',
      message: 'Design not found: image_id=img-1',
      exitClass: 4
    });
    await expect(client.getDesignSchemaJson(REQUEST)).rejects.toMatchObject({
      code: 'DESIGN_NOT_FOUND'
    });
  });

  test('getDesignSchemaJson requires data_resource_url from DDS lookup', async () => {
    const ddsBodies = [
      { code: '10001', msg: 'broken' },
      { code: '00000', data: {} }
    ];
    let ddsCall = 0;
    const { client } = makeClient(url => {
      if (url.pathname === '/api/project/multi_info') {
        return jsonResponse({
          code: '00000',
          result: { images: [{ id: 'img-1', latest_version: 'v-1' }] }
        });
      }
      if (url.pathname === '/api/dds/image/store_schema_revise') {
        return jsonResponse(ddsBodies[ddsCall++]);
      }
      return undefined;
    });

    await expect(client.getDesignSchemaJson(REQUEST)).rejects.toThrow(
      'Lanhu API /api/dds/image/store_schema_revise returned empty data (10001 broken)'
    );
    await expect(client.getDesignSchemaJson(REQUEST)).rejects.toMatchObject({
      code: 'SCHEMA_FIELD_MISSING',
      message: 'store_schema_revise did not return data_resource_url'
    });
  });
});

describe('LanhuClient — meta fallbacks', () => {
  test('picks preview URLs and project names across payload variants', async () => {
    const bodies = [
      {
        code: '00000',
        result: {
          name: 'Home',
          image_url: 'https://example.com/preview.png',
          project_name: 'Project A',
          versions: []
        }
      },
      {
        code: '00000',
        result: {
          versions: [{ imageUrl: 'https://example.com/version-preview.png' }],
          projectName: 'Project B'
        }
      },
      { code: '00000', result: {} }
    ];
    let call = 0;
    const { client } = makeClient(url => {
      if (url.pathname === '/api/project/image') {
        return jsonResponse(bodies[call++]);
      }
      return undefined;
    });

    await expect(client.getDesignMeta(REQUEST)).resolves.toEqual({
      id: 'img-1',
      name: 'Home',
      url: 'https://example.com/preview.png',
      projectName: 'Project A',
      versions: { count: 0, latestHasSketchJson: false }
    });
    await expect(client.getDesignMeta(REQUEST)).resolves.toEqual({
      id: 'img-1',
      name: 'img-1',
      url: 'https://example.com/version-preview.png',
      projectName: 'Project B',
      versions: { count: 1, latestHasSketchJson: false }
    });
    await expect(client.getDesignMeta(REQUEST)).resolves.toEqual({
      id: 'img-1',
      name: 'img-1',
      url: undefined,
      projectName: undefined,
      versions: { count: 0, latestHasSketchJson: false }
    });
  });
});

describe('LanhuClient — sketch json', () => {
  test('returns the referenced JSON and validates version data', async () => {
    const imageBodies = [
      {
        code: '00000',
        result: { versions: [{ json_url: 'https://lanhuapp.com/sketch.json' }] }
      },
      { code: '00000', result: { versions: [] } },
      { code: '00000', result: { versions: [{}] } }
    ];
    let call = 0;
    const { client, calls } = makeClient(url => {
      if (url.pathname === '/api/project/image') {
        return jsonResponse(imageBodies[call++]);
      }
      if (url.pathname === '/sketch.json') {
        return jsonResponse({ artboard: { id: 'artboard-1' } });
      }
      return undefined;
    });

    await expect(client.getSketchJson(REQUEST)).resolves.toEqual({
      artboard: { id: 'artboard-1' }
    });
    expect(new URL(calls[1].url).pathname).toBe('/sketch.json');

    await expect(client.getSketchJson(REQUEST)).rejects.toMatchObject({
      code: 'SCHEMA_FIELD_MISSING',
      message: 'No versions found for design'
    });
    await expect(client.getSketchJson(REQUEST)).rejects.toMatchObject({
      code: 'SCHEMA_FIELD_MISSING',
      message: 'No json_url in design version'
    });
  });
});

describe('LanhuClient — downloadImage', () => {
  test('strips x-oss-process, keeps signed params, and returns a Buffer', async () => {
    const { client, calls } = makeClient(url => {
      if (url.pathname === '/a.png') {
        return new Response(Uint8Array.from([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' }
        });
      }
      return undefined;
    });

    const buffer = await client.downloadImage({
      imgUrl:
        'https://example.com/a.png?OSSAccessKeyId=k&Expires=1&Signature=s&x-oss-process=image/resize'
    });

    expect(calls[0].url).toBe(
      'https://example.com/a.png?OSSAccessKeyId=k&Expires=1&Signature=s'
    );
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect([...buffer]).toEqual([1, 2, 3]);
  });
});

describe('LanhuClient — transport failures', () => {
  test('network errors are classified as retryable UPSTREAM_ERROR', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed: socket hang up');
    }) as typeof globalThis.fetch;
    const client = new LanhuClient({ lanhuToken: 't', fetch: fetchImpl });

    await expect(client.getDesignMeta(REQUEST)).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      exitClass: 5,
      retryable: true
    });
  });

  test('abort/timeout errors are classified as UPSTREAM_TIMEOUT', async () => {
    const fetchImpl = (async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }) as typeof globalThis.fetch;
    const client = new LanhuClient({ lanhuToken: 't', fetch: fetchImpl });

    await expect(client.getDesignMeta(REQUEST)).rejects.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
      exitClass: 5,
      retryable: true
    });
  });
});
