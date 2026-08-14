// Structured envelopes (DESIGN.md §5.1). Success and failure envelopes are
// both "data" and therefore go to stdout when JSON mode is in effect; the
// first failure signal for consumers is always the non-zero exit code.

import {
  type LanhuSeverity,
  type LanhuWarning,
  toLanhuError
} from '@lanhu-context/core';
import { CLI_VERSION } from '../version';

export interface EnvelopeErrorBody {
  code: string;
  severity: LanhuSeverity;
  message: string;
  hint: string;
  retryable: boolean;
}

export interface SuccessEnvelope {
  ok: true;
  command: string;
  data: unknown;
  warnings: LanhuWarning[];
  meta: { version: string; durationMs: number };
}

export interface FailureEnvelope {
  ok: false;
  command: string;
  error: EnvelopeErrorBody;
}

export type Envelope = SuccessEnvelope | FailureEnvelope;

export function successEnvelope(
  command: string,
  data: unknown,
  warnings: LanhuWarning[],
  durationMs: number
): SuccessEnvelope {
  return {
    ok: true,
    command,
    data,
    warnings,
    meta: { version: CLI_VERSION, durationMs }
  };
}

export function failureEnvelope(
  command: string,
  error: unknown
): FailureEnvelope {
  const e = toLanhuError(error);
  return {
    ok: false,
    command,
    error: {
      code: e.code,
      severity: e.severity,
      message: e.message,
      hint: e.hint,
      retryable: e.retryable
    }
  };
}

// --strict escalates degraded warnings into a failure (exit class 8). The
// error code keeps the first warning's code so consumers can still branch on
// the concrete cause; severity is reported as fatal because the run failed.
export function strictFailureEnvelope(
  command: string,
  warnings: LanhuWarning[]
): FailureEnvelope {
  const first = warnings[0];
  const summary = warnings.map(w => `${w.code}: ${w.message}`).join('; ');
  return {
    ok: false,
    command,
    error: {
      code: first?.code ?? 'UNKNOWN',
      severity: 'fatal',
      message: `--strict: ${warnings.length} warning(s) escalated to failure — ${summary}`,
      hint:
        first?.hint ??
        'Re-run without --strict to accept degraded output, or fix the warned stage.',
      retryable: false
    }
  };
}

export function serializeEnvelope(envelope: Envelope): string {
  return JSON.stringify(envelope);
}
