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
export const EXIT_BATCH_PARTIAL = 9;

// LanhuError.exitClass drives the process exit code; anything else is an
// unclassified internal error (exit 1).
export function exitCodeForError(error: unknown): number {
  if (isLanhuError(error)) {
    const cls = error.exitClass;
    if (
      Number.isInteger(cls) &&
      cls >= EXIT_UNKNOWN &&
      cls <= EXIT_BATCH_PARTIAL
    ) {
      return cls;
    }
  }
  return EXIT_UNKNOWN;
}

// Set the exit code without calling process.exit(): stdio is left to drain
// naturally so large piped artifacts are never truncated.
export function finishWith(code: number): void {
  if (code !== EXIT_OK) {
    process.exitCode = code;
  }
}
