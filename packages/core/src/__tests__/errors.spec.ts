// Table-driven tests for the error registry (DESIGN.md §6.2 / §11 M1 DoD):
// every code's exitClass / severity / retryable mapping is asserted in full.
import {
  ERROR_REGISTRY,
  isLanhuError,
  LanhuError,
  type LanhuErrorCode,
  type LanhuErrorSpec,
  type LanhuSeverity,
  makeWarning,
  toLanhuError
} from '../errors';

// The single source of truth for the expected mapping. If a code is added to
// the registry without updating this table, the completeness test fails.
const EXPECTED: Record<
  LanhuErrorCode,
  { exitClass: number; severity: LanhuSeverity; retryable: boolean }
> = {
  URL_INVALID: { exitClass: 2, severity: 'fatal', retryable: false },
  URL_MISSING_TID: { exitClass: 2, severity: 'fatal', retryable: false },
  URL_MISSING_PID: { exitClass: 2, severity: 'fatal', retryable: false },
  URL_MISSING_IMAGE_ID: { exitClass: 2, severity: 'fatal', retryable: false },
  USAGE_ERROR: { exitClass: 2, severity: 'fatal', retryable: false },
  CONFIG_INVALID: { exitClass: 3, severity: 'fatal', retryable: false },
  TOKEN_MISSING: { exitClass: 3, severity: 'fatal', retryable: false },
  AUTH_EXPIRED: { exitClass: 4, severity: 'fatal', retryable: false },
  ACCESS_DENIED: { exitClass: 4, severity: 'fatal', retryable: false },
  EMPTY_RESULT: { exitClass: 4, severity: 'fatal', retryable: false },
  DESIGN_NOT_FOUND: { exitClass: 4, severity: 'fatal', retryable: false },
  UPSTREAM_TIMEOUT: { exitClass: 5, severity: 'fatal', retryable: true },
  UPSTREAM_ERROR: { exitClass: 5, severity: 'fatal', retryable: true },
  SCHEMA_FIELD_MISSING: { exitClass: 5, severity: 'fatal', retryable: false },
  TRANSFORM_FAILED: { exitClass: 6, severity: 'fatal', retryable: false },
  IO_WRITE_FAILED: { exitClass: 7, severity: 'fatal', retryable: false },
  BATCH_PARTIAL: { exitClass: 9, severity: 'fatal', retryable: false },
  TOKENS_UNAVAILABLE: { exitClass: 0, severity: 'degraded', retryable: false },
  PREVIEW_UNAVAILABLE: { exitClass: 0, severity: 'degraded', retryable: true },
  TAILWIND_FALLBACK: { exitClass: 0, severity: 'degraded', retryable: false },
  UNKNOWN: { exitClass: 1, severity: 'fatal', retryable: false }
};

describe('ERROR_REGISTRY — full code → class/severity/retryable mapping', () => {
  const codes = Object.keys(ERROR_REGISTRY) as LanhuErrorCode[];

  test('the expectation table covers every registered code and vice versa', () => {
    expect(new Set(codes)).toEqual(
      new Set(Object.keys(EXPECTED) as LanhuErrorCode[])
    );
  });

  test.each(codes)(
    '%s maps to its expected exitClass/severity/retryable',
    code => {
      const spec: LanhuErrorSpec = ERROR_REGISTRY[code];
      expect({
        exitClass: spec.exitClass,
        severity: spec.severity,
        retryable: spec.retryable
      }).toEqual(EXPECTED[code]);
    }
  );

  test.each(codes)('%s has a non-empty actionable hint', code => {
    expect(ERROR_REGISTRY[code].hint.length).toBeGreaterThan(10);
  });

  test('degraded codes never claim a non-zero exit class', () => {
    for (const code of codes) {
      const spec: LanhuErrorSpec = ERROR_REGISTRY[code];
      if (spec.severity === 'degraded') expect(spec.exitClass).toBe(0);
      if (spec.exitClass === 0) expect(spec.severity).not.toBe('fatal');
    }
  });

  test('exit class 8 is reserved for the CLI --strict escalation (never registered)', () => {
    for (const code of codes) {
      expect(ERROR_REGISTRY[code].exitClass).not.toBe(8);
    }
  });
});

describe('LanhuError', () => {
  test('copies registry fields and supports hint/cause overrides', () => {
    const cause = new Error('root cause');
    const e = new LanhuError('AUTH_EXPIRED', 'token expired', { cause });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('LanhuError');
    expect(e.message).toBe('token expired');
    expect(e.code).toBe('AUTH_EXPIRED');
    expect(e.severity).toBe('fatal');
    expect(e.exitClass).toBe(4);
    expect(e.retryable).toBe(false);
    expect(e.hint).toBe(ERROR_REGISTRY.AUTH_EXPIRED.hint);
    expect(e.cause).toBe(cause);

    const custom = new LanhuError('UNKNOWN', 'boom', { hint: 'try again' });
    expect(custom.hint).toBe('try again');
  });

  test('isLanhuError narrows correctly', () => {
    expect(isLanhuError(new LanhuError('UNKNOWN', 'x'))).toBe(true);
    expect(isLanhuError(new Error('x'))).toBe(false);
    expect(isLanhuError('x')).toBe(false);
  });

  test('toLanhuError passes existing LanhuError through and wraps others', () => {
    const original = new LanhuError('EMPTY_RESULT', 'empty');
    expect(toLanhuError(original)).toBe(original);

    const wrapped = toLanhuError(new Error('plain'), 'UPSTREAM_ERROR');
    expect(wrapped.code).toBe('UPSTREAM_ERROR');
    expect(wrapped.message).toBe('plain');
    expect(wrapped.retryable).toBe(true);

    const fromString = toLanhuError('oops');
    expect(fromString.code).toBe('UNKNOWN');
    expect(fromString.message).toBe('oops');
  });
});

describe('makeWarning', () => {
  test('builds a warning with severity/hint from the registry', () => {
    const w = makeWarning('TOKENS_UNAVAILABLE', 'sketch json missing');
    expect(w).toEqual({
      code: 'TOKENS_UNAVAILABLE',
      severity: 'degraded',
      message: 'sketch json missing',
      hint: ERROR_REGISTRY.TOKENS_UNAVAILABLE.hint
    });
  });

  test('supports a custom hint', () => {
    const w = makeWarning('PREVIEW_UNAVAILABLE', 'msg', 'custom hint');
    expect(w.hint).toBe('custom hint');
  });
});
