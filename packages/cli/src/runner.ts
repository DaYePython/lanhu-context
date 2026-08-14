// Command runner: wraps every command with the shared lifecycle —
// config resolution, warning collection, --strict escalation, envelope
// emission per the §5 channel rules, and the single exit-code decision.
//
// Channel rules recap (DESIGN.md §5):
// - stdout carries data/artifacts only; diagnostics go to stderr (consola).
// - report commands: --json (or auto-JSON when stdout is not a TTY) emits an
//   envelope; TTY without --json renders human-readable output.
// - artifact commands: stdout always carries the raw artifact, TTY or not;
//   only an explicit --json switches to an envelope with the artifact in data.
// - binary artifacts (`preview -o -`) go to stdout raw with no envelope; the
//   status lives in the exit code + stderr.
// - failure envelopes go to stdout whenever JSON mode is in effect; the first
//   failure signal is the non-zero exit code. Human diagnostics always go to
//   stderr.
// - batch mode (--stdin, §5.1): one full envelope per input line as NDJSON
//   with an `input` echo field, summary {total, ok, failed} on stderr, and
//   the §6.2 batch exit-code rules (0 / first-failure / 9 / dominant class).

import type { Buffer } from 'node:buffer';
import {
  LanhuError,
  type LanhuWarning,
  toLanhuError
} from '@lanhu-context/core';
import type { ConsolaInstance } from 'consola';
import { type AnyParsedArgs, toConfigFlags } from './args';
import { type ResolvedConfig, resolveConfig } from './config/index';
import { EXIT_OK, EXIT_STRICT, exitCodeForError, finishWith } from './exit';
import { decideBatchExit, parseBatchLine } from './io/batch';
import {
  type Envelope,
  failureEnvelope,
  serializeEnvelope,
  strictFailureEnvelope,
  successEnvelope
} from './io/envelope';
import { createLogger } from './io/logger';
import { type CommandKind, shouldEmitJson, writeStdout } from './io/output';
import { readStdin } from './io/stdin';

export interface HandlerResult {
  /** Structured data — envelope `data` and the source for human rendering. */
  data: unknown;
  /** Raw stdout content for artifact commands (ignored for reports). */
  artifact?: string;
  /** Raw binary stdout (e.g. `preview -o -`); takes precedence over
   * `artifact` and is written without a trailing newline. */
  binary?: Buffer;
  /** Human-readable stdout rendering for report commands on a TTY. */
  render?: () => string;
  /** Extra stderr info lines after success (e.g. --inline summaries). */
  summary?: string[];
  /** Non-zero exit for report commands whose run succeeded but whose
   * findings did not (e.g. `doctor` with failed checks). */
  exitCode?: number;
}

export interface RunnerContext {
  args: AnyParsedArgs;
  rawArgs: string[];
  config: ResolvedConfig;
  logger: ConsolaInstance;
  /** Push degraded/notice warnings here; they land in the envelope. */
  warnings: LanhuWarning[];
  /** Time a stage and log its duration at debug level (--verbose). */
  timed<T>(label: string, fn: () => Promise<T>): Promise<T>;
}

export interface ExecuteOptions {
  command: string;
  /** May depend on args: `context` is a report unless --inline. */
  kind: CommandKind | ((args: AnyParsedArgs) => CommandKind);
  args: AnyParsedArgs;
  rawArgs: string[];
  /** Usage validation before config/handler; throw USAGE_ERROR here. */
  preValidate?: (args: AnyParsedArgs) => void;
  handler: (ctx: RunnerContext) => Promise<HandlerResult>;
  /** Per-entry handler enabling `--stdin` batch mode for this command. */
  batchItem?: (url: string, ctx: RunnerContext) => Promise<{ data: unknown }>;
}

export async function executeCommand(options: ExecuteOptions): Promise<void> {
  const { args, rawArgs } = options;
  if (args.color === false) process.env.NO_COLOR = '1';

  const logger = createLogger({
    quiet: args.quiet === true,
    verbose: args.verbose === true
  });
  const kind =
    typeof options.kind === 'function' ? options.kind(args) : options.kind;
  const json = shouldEmitJson(
    kind,
    args.json === true,
    process.stdout.isTTY === true
  );
  const warnings: LanhuWarning[] = [];
  const started = Date.now();

  try {
    options.preValidate?.(args);
    validateBatchFlags(options);

    // Deprecated alias notice (§10 compatibility discipline).
    if (rawArgs.includes('--tailwindcss')) {
      logger.warn(
        'deprecation: `--tailwindcss` 已更名为 `--tailwind`，旧名将在后续 minor 版本移除'
      );
    }

    const config = resolveConfig(toConfigFlags(args));
    const ctx: RunnerContext = {
      args,
      rawArgs,
      config,
      logger,
      warnings,
      timed: async (label, fn) => {
        const t0 = Date.now();
        try {
          return await fn();
        } finally {
          logger.debug(`stage ${label}: ${Date.now() - t0}ms`);
        }
      }
    };

    if (args.stdin === true) {
      await runBatch(options, ctx);
      return;
    }

    const result = await options.handler(ctx);
    const durationMs = Date.now() - started;

    // Warnings are always visible on stderr, JSON mode or not.
    for (const w of warnings) {
      logger.warn(`${w.code}: ${w.message}`);
    }

    // --strict: any warning escalates the whole run to a failure (exit 8).
    if (args.strict === true && warnings.length > 0) {
      const envelope = strictFailureEnvelope(options.command, warnings);
      logger.error(envelope.error.message);
      if (json) writeStdout(serializeEnvelope(envelope));
      finishWith(EXIT_STRICT);
      return;
    }

    if (json) {
      writeStdout(
        serializeEnvelope(
          successEnvelope(options.command, result.data, warnings, durationMs)
        )
      );
    } else if (kind === 'artifact') {
      if (result.binary !== undefined) {
        process.stdout.write(result.binary);
      } else {
        writeStdout(result.artifact ?? '');
      }
    } else {
      writeStdout(
        result.render ? result.render() : JSON.stringify(result.data, null, 2)
      );
    }

    for (const line of result.summary ?? []) {
      logger.info(line);
    }
    logger.debug(`total: ${durationMs}ms`);
    finishWith(result.exitCode ?? EXIT_OK);
  } catch (error) {
    const err = toLanhuError(error);
    const hintSuffix = err.hint ? `\nhint: ${err.hint}` : '';
    logger.error(`${err.code}: ${err.message}${hintSuffix}`);
    if (json) {
      writeStdout(serializeEnvelope(failureEnvelope(options.command, err)));
    }
    finishWith(exitCodeForError(err));
  }
}

// --stdin usage rules (§5.1): only commands with a batchItem handler support
// it, and it is mutually exclusive with a positional url/`-` and --inline.
function validateBatchFlags(options: ExecuteOptions): void {
  const { args } = options;
  if (args.stdin !== true) return;
  if (!options.batchItem) {
    throw new LanhuError(
      'USAGE_ERROR',
      `\`${options.command}\` does not support --stdin batch mode (supported: parse, meta, context)`
    );
  }
  if (typeof args.url === 'string' && args.url !== '') {
    throw new LanhuError(
      'USAGE_ERROR',
      '--stdin 与位置参数（url 或 -）互斥：批处理模式从 stdin 逐行读取 URL'
    );
  }
  if (args.inline === true) {
    throw new LanhuError(
      'USAGE_ERROR',
      '--stdin 与 --inline 互斥：批处理的 stdout 是 NDJSON envelope 流'
    );
  }
}

// Batch executor (§5.1): NDJSON envelopes on stdout, summary on stderr.
async function runBatch(
  options: ExecuteOptions,
  baseCtx: RunnerContext
): Promise<void> {
  const { args, command } = { args: options.args, command: options.command };
  const logger = baseCtx.logger;
  const keepGoing = args['keep-going'] === true;
  const batchItem = options.batchItem;
  if (!batchItem) return; // validated earlier

  const raw = await readStdin();
  const lines = raw.split('\n');

  let ok = 0;
  const failureCodes: number[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const startedAt = Date.now();
    const itemWarnings: LanhuWarning[] = [];
    let envelope: Envelope & { input: string };
    let itemExit = EXIT_OK;

    try {
      const url = parseBatchLine(line);
      const itemCtx: RunnerContext = { ...baseCtx, warnings: itemWarnings };
      const { data } = await batchItem(url, itemCtx);

      for (const w of itemWarnings) {
        logger.warn(`${w.code}: ${w.message}`);
      }
      if (args.strict === true && itemWarnings.length > 0) {
        envelope = {
          ...strictFailureEnvelope(command, itemWarnings),
          input: line
        };
        itemExit = EXIT_STRICT;
      } else {
        envelope = {
          ...successEnvelope(
            command,
            data,
            itemWarnings,
            Date.now() - startedAt
          ),
          input: line
        };
      }
    } catch (error) {
      const err = toLanhuError(error);
      logger.error(`${err.code}: ${err.message}`);
      envelope = { ...failureEnvelope(command, err), input: line };
      itemExit = exitCodeForError(err);
    }

    writeStdout(JSON.stringify(envelope));

    if (itemExit === EXIT_OK) {
      ok += 1;
    } else {
      failureCodes.push(itemExit);
      if (!keepGoing) break;
    }
  }

  const failed = failureCodes.length;
  const total = ok + failed;
  logger.info(`batch: ${JSON.stringify({ total, ok, failed })}`);
  finishWith(decideBatchExit({ ok, failed, keepGoing, failureCodes }));
}
