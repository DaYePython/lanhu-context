// HTTP status classification (DESIGN.md §6.2): 4xx rejections (including
// Lanhu's WAF-style 418 for forged cookies) are auth/permission failures
// (exit class 4, never retried); 5xx and 408/429 stay retryable upstream
// errors (exit class 5).
import { LanhuError } from '../../errors';
import { LanhuClient } from '../client';

const REQUEST = { teamId: 't', projectId: 'p', imageId: 'i' };

function makeStatusClient(status: number) {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(`upstream said ${status}`, { status });
  }) as typeof globalThis.fetch;
  const client = new LanhuClient({
    lanhuToken: 'cookie',
    retries: 2,
    retryBaseDelayMs: 1,
    fetch: fetchImpl
  });
  return { client, callCount: () => calls };
}

async function captureError(promise: Promise<unknown>): Promise<LanhuError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LanhuError);
    return error as LanhuError;
  }
  throw new Error('expected the call to reject');
}

describe('LanhuClient — HTTP status classification', () => {
  test.each([
    [401, 'AUTH_EXPIRED'],
    [403, 'ACCESS_DENIED'],
    [404, 'DESIGN_NOT_FOUND'],
    [418, 'AUTH_EXPIRED'] // Lanhu WAF answer for forged/expired cookies
  ] as const)(
    'HTTP %d maps to %s (exit 4) and is never retried',
    async (status, code) => {
      const { client, callCount } = makeStatusClient(status);
      const error = await captureError(client.getDesignMeta(REQUEST));
      expect(error.code).toBe(code);
      expect(error.exitClass).toBe(4);
      expect(error.retryable).toBe(false);
      expect(callCount()).toBe(1); // retries: 2 configured, none used
    }
  );

  test.each([[500], [502], [429], [408]])(
    'HTTP %d stays a retryable UPSTREAM_ERROR (exit 5)',
    async status => {
      const { client, callCount } = makeStatusClient(status);
      const error = await captureError(client.getDesignMeta(REQUEST));
      expect(error.code).toBe('UPSTREAM_ERROR');
      expect(error.exitClass).toBe(5);
      expect(error.retryable).toBe(true);
      expect(callCount()).toBe(3); // initial + 2 retries
    }
  );
});
