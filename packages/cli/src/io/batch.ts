// Batch-mode helpers (DESIGN.md §5.1 --stdin): input line parsing and the
// overall exit-code decision.

import { LanhuError } from '@lanhu-context/core';

/**
 * Parse one batch input line into a URL. A line is either a plain URL /
 * query string, or an NDJSON object with a "url" field. Blank lines are the
 * caller's job to skip.
 */
export function parseBatchLine(line: string): string {
  if (line.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LanhuError(
        'USAGE_ERROR',
        `batch input line is not valid NDJSON: ${message}`
      );
    }
    const url = (parsed as { url?: unknown }).url;
    if (typeof url !== 'string' || url === '') {
      throw new LanhuError(
        'USAGE_ERROR',
        'batch NDJSON line is missing a non-empty "url" field'
      );
    }
    return url;
  }
  return line;
}

/**
 * The most frequent exit code among the failures; ties resolve to the code
 * seen first (§6.2 "全失败取主导错误类别码").
 */
export function dominantExitCode(codes: number[]): number {
  const counts = new Map<number, number>();
  for (const code of codes) {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best: number | undefined;
  let bestCount = 0;
  for (const code of codes) {
    const count = counts.get(code) ?? 0;
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best ?? 1;
}

export interface BatchOutcome {
  ok: number;
  failed: number;
  keepGoing: boolean;
  /** Exit codes of the failed entries, in order. */
  failureCodes: number[];
}

/**
 * Overall batch exit code (§6.2): all ok -> 0; without --keep-going the run
 * stopped at the first failure and exits with that entry's code; with
 * --keep-going a partial failure is 9 (BATCH_PARTIAL) and a total failure
 * takes the dominant error class.
 */
export function decideBatchExit(outcome: BatchOutcome): number {
  if (outcome.failed === 0) return 0;
  if (!outcome.keepGoing) {
    return outcome.failureCodes[outcome.failureCodes.length - 1] ?? 1;
  }
  if (outcome.ok > 0) return 9;
  return dominantExitCode(outcome.failureCodes);
}
