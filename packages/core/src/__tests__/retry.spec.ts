// Unit tests for withRetry (DESIGN.md §6.3): retryable-only, exponential
// backoff, never retrying credential/usage errors.
import { LanhuError } from '../errors';
import { isRetryableError, withRetry } from '../retry';

const noSleep = async (_ms: number): Promise<void> => {};

describe('withRetry', () => {
  test('returns the first successful result without retrying', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return 'ok';
      },
      { sleep: noSleep }
    );
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  test('retries retryable LanhuErrors up to `retries` times then rethrows', async () => {
    let calls = 0;
    const attempts: Array<{ attempt: number; delayMs: number }> = [];
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new LanhuError('UPSTREAM_TIMEOUT', 'timeout');
        },
        {
          retries: 2,
          baseDelayMs: 100,
          sleep: noSleep,
          onRetry: (_e, attempt, delayMs) => attempts.push({ attempt, delayMs })
        }
      )
    ).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
    expect(calls).toBe(3); // initial + 2 retries
    // Exponential backoff: 100ms then 200ms.
    expect(attempts).toEqual([
      { attempt: 1, delayMs: 100 },
      { attempt: 2, delayMs: 200 }
    ]);
  });

  test('succeeds when a retry eventually passes', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new LanhuError('UPSTREAM_ERROR', '5xx');
        return 'recovered';
      },
      { retries: 2, sleep: noSleep }
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  test('never retries non-retryable LanhuErrors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new LanhuError('AUTH_EXPIRED', 'expired');
        },
        { retries: 5, sleep: noSleep }
      )
    ).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
    expect(calls).toBe(1);
  });

  test('never retries plain (non-Lanhu) errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('boom');
        },
        { retries: 5, sleep: noSleep }
      )
    ).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });

  test('caps the backoff delay at maxDelayMs', async () => {
    const delays: number[] = [];
    await expect(
      withRetry(
        async () => {
          throw new LanhuError('UPSTREAM_TIMEOUT', 'timeout');
        },
        {
          retries: 4,
          baseDelayMs: 1000,
          maxDelayMs: 2500,
          sleep: noSleep,
          onRetry: (_e, _attempt, delayMs) => delays.push(delayMs)
        }
      )
    ).rejects.toBeInstanceOf(LanhuError);
    expect(delays).toEqual([1000, 2000, 2500, 2500]);
  });
});

describe('isRetryableError', () => {
  test('only retryable LanhuErrors qualify', () => {
    expect(isRetryableError(new LanhuError('UPSTREAM_TIMEOUT', 'x'))).toBe(
      true
    );
    expect(isRetryableError(new LanhuError('EMPTY_RESULT', 'x'))).toBe(false);
    expect(isRetryableError(new Error('x'))).toBe(false);
    expect(isRetryableError('x')).toBe(false);
  });
});
