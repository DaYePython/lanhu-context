// LanhuClient retry behavior (DESIGN.md §6.3): retryable transport failures
// are retried with backoff, business failures (EMPTY_RESULT) are not.
import { LanhuError } from '../../errors';
import { LanhuClient } from '../client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const REQUEST = { teamId: 't', projectId: 'p', imageId: 'i' };

describe('LanhuClient — retry policy', () => {
  test('retries network failures up to `retries` and then succeeds', async () => {
    let calls = 0;
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      // The projectName fallback hits multi_info; answer it directly so
      // `calls` counts only the /api/project/image attempts under test.
      if (new Request(input, init).url.includes('/api/project/multi_info')) {
        return jsonResponse({ code: '00000', result: { name: 'Project A' } });
      }
      calls += 1;
      if (calls <= 2) throw new TypeError('fetch failed');
      return jsonResponse({
        code: '00000',
        result: { name: 'Design A', versions: [] }
      });
    }) as typeof globalThis.fetch;

    const client = new LanhuClient({
      lanhuToken: 'cookie',
      retries: 2,
      retryBaseDelayMs: 1,
      fetch: fetchImpl
    });
    const meta = await client.getDesignMeta(REQUEST);
    expect(meta.name).toBe('Design A');
    expect(meta.projectName).toBe('Project A');
    expect(calls).toBe(3);
  });

  test('gives up after exhausting retries with the classified error', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch;

    const client = new LanhuClient({
      lanhuToken: 'cookie',
      retries: 1,
      retryBaseDelayMs: 1,
      fetch: fetchImpl
    });
    await expect(client.getDesignMeta(REQUEST)).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      exitClass: 5,
      retryable: true
    });
    expect(calls).toBe(2);
  });

  test('does not retry EMPTY_RESULT (business failure, exit class 4)', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({ code: '401', msg: 'no auth', result: null });
    }) as typeof globalThis.fetch;

    const client = new LanhuClient({
      lanhuToken: 'cookie',
      retries: 3,
      retryBaseDelayMs: 1,
      fetch: fetchImpl
    });
    try {
      await client.getDesignMeta(REQUEST);
      throw new Error('expected EMPTY_RESULT');
    } catch (error) {
      expect(error).toBeInstanceOf(LanhuError);
      expect((error as LanhuError).code).toBe('EMPTY_RESULT');
    }
    expect(calls).toBe(1);
  });

  test('defaults to zero retries when the option is omitted', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch;

    const client = new LanhuClient({ lanhuToken: 'cookie', fetch: fetchImpl });
    await expect(client.getDesignMeta(REQUEST)).rejects.toBeInstanceOf(
      LanhuError
    );
    expect(calls).toBe(1);
  });
});
