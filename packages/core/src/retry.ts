// Retry policy (DESIGN.md §6.3): only LanhuError with `retryable: true`
// (network timeouts, 5xx, OSS downloads) is retried, with exponential
// backoff. URL / credential / permission errors are never retried.

import { isLanhuError } from './errors';

export interface WithRetryOptions {
  /** Number of retries after the first attempt. Default 2. */
  retries?: number;
  /** Base backoff delay in ms; attempt n waits base * 2^n. Default 300. */
  baseDelayMs?: number;
  /** Upper bound for a single backoff delay. Default 5000. */
  maxDelayMs?: number;
  /** Observer invoked before each retry (attempt is 1-based). */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export function isRetryableError(error: unknown): boolean {
  return isLanhuError(error) && error.retryable;
}

// Run `fn`, retrying retryable LanhuErrors with exponential backoff.
// Non-retryable errors (and non-LanhuError values) are rethrown immediately.
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions = {}
): Promise<T> {
  const retries = Math.max(0, options.retries ?? 2);
  const baseDelayMs = options.baseDelayMs ?? 300;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const sleep = options.sleep ?? defaultSleep;

  let attempt = 0;
  // attempt 0 is the initial call; up to `retries` further attempts follow.
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableError(error) || attempt >= retries) throw error;
      const delayMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      attempt += 1;
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
}
