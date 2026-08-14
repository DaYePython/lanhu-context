// Envelope serialization (DESIGN.md §5.1).
import { LanhuError, makeWarning } from '@lanhu-context/core';
import {
  failureEnvelope,
  serializeEnvelope,
  strictFailureEnvelope,
  successEnvelope
} from '../io/envelope';
import { CLI_VERSION } from '../version';

describe('successEnvelope', () => {
  test('carries ok/command/data/warnings/meta', () => {
    const warning = makeWarning('TOKENS_UNAVAILABLE', 'no sketch json');
    const envelope = successEnvelope(
      'context',
      { designName: 'Home' },
      [warning],
      1234
    );
    expect(envelope).toEqual({
      ok: true,
      command: 'context',
      data: { designName: 'Home' },
      warnings: [warning],
      meta: { version: CLI_VERSION, durationMs: 1234 }
    });
    // Round-trips through JSON.
    expect(JSON.parse(serializeEnvelope(envelope))).toEqual(envelope);
  });
});

describe('failureEnvelope', () => {
  test('maps a LanhuError to the §5.1 error body', () => {
    const envelope = failureEnvelope(
      'schema',
      new LanhuError('EMPTY_RESULT', 'empty result payload')
    );
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe('schema');
    expect(envelope.error).toEqual({
      code: 'EMPTY_RESULT',
      severity: 'fatal',
      message: 'empty result payload',
      hint: expect.stringContaining('token'),
      retryable: false
    });
  });

  test('wraps unknown thrown values as UNKNOWN', () => {
    const envelope = failureEnvelope('parse', new Error('boom'));
    expect(envelope.error.code).toBe('UNKNOWN');
    expect(envelope.error.message).toBe('boom');
  });
});

describe('strictFailureEnvelope', () => {
  test('escalates warnings keeping the first warning code', () => {
    const warnings = [
      makeWarning('TAILWIND_FALLBACK', 'tw failed'),
      makeWarning('PREVIEW_UNAVAILABLE', 'preview 404')
    ];
    const envelope = strictFailureEnvelope('html', warnings);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('TAILWIND_FALLBACK');
    expect(envelope.error.severity).toBe('fatal');
    expect(envelope.error.retryable).toBe(false);
    expect(envelope.error.message).toContain('--strict');
    expect(envelope.error.message).toContain('2 warning(s)');
    expect(envelope.error.message).toContain('PREVIEW_UNAVAILABLE');
  });
});
