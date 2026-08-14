// Channel discipline (DESIGN.md §5): stdout carries data/artifacts only;
// all diagnostics (progress, warnings, errors) go to stderr via consola.

import { type ConsolaInstance, createConsola } from 'consola';

export interface LoggerFlags {
  quiet?: boolean;
  verbose?: boolean;
}

// consola levels: 0 = fatal/error, 1 = warn, 3 = info/log, 4 = debug.
export function createLogger(flags: LoggerFlags = {}): ConsolaInstance {
  return createConsola({
    level: flags.quiet ? 0 : flags.verbose ? 4 : 3,
    formatOptions: { date: false },
    stdout: process.stderr,
    stderr: process.stderr
  });
}
