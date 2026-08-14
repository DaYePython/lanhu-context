// DESIGN.md §6.2 — the single place that maps failures to process exit codes.
// Every command funnels through the runner, which calls finishWith() exactly
// once; nothing else in the CLI sets process.exitCode.

import { isLanhuError } from '@lanhu-context/core';

export const EXIT_OK = 0;
export const EXIT_UNKNOWN = 1;
export const EXIT_USAGE = 2;
export const EXIT_CONFIG = 3;
export const EXIT_AUTH = 4;
export const EXIT_UPSTREAM = 5;
export const EXIT_TRANSFORM = 6;
export const EXIT_IO = 7;
export const EXIT_STRICT = 8;

// LanhuError.exitClass drives the process exit code; anything else is an
// unclassified internal error (exit 1).
export function exitCodeForError(error: unknown): number {
  if (isLanhuError(error)) {
    const cls = error.exitClass;
    if (Number.isInteger(cls) && cls >= EXIT_UNKNOWN && cls <= EXIT_STRICT) {
      return cls;
    }
  }
  return EXIT_UNKNOWN;
}

/**
 * The most frequent exit class among a set of failures; ties resolve to the
 * class seen first (§6.2 "取主导错误类别码", used by `doctor`).
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

// Set the exit code without calling process.exit(): stdio is left to drain
// naturally so large piped artifacts are never truncated.
export function finishWith(code: number): void {
  if (code !== EXIT_OK) {
    process.exitCode = code;
  }
}
