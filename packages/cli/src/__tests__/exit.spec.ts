// Exit code mapping (DESIGN.md §6.2): LanhuError.exitClass drives the code;
// everything else is exit 1.
import { LanhuError } from '@lanhu-context/core';
import { EXIT_STRICT, exitCodeForError } from '../exit';

describe('exitCodeForError', () => {
  test.each([
    ['URL_MISSING_TID', 2],
    ['USAGE_ERROR', 2],
    ['CONFIG_INVALID', 3],
    ['TOKEN_MISSING', 3],
    ['AUTH_EXPIRED', 4],
    ['ACCESS_DENIED', 4],
    ['EMPTY_RESULT', 4],
    ['UPSTREAM_TIMEOUT', 5],
    ['UPSTREAM_ERROR', 5],
    ['SCHEMA_FIELD_MISSING', 5],
    ['TRANSFORM_FAILED', 6],
    ['IO_WRITE_FAILED', 7],
    ['BATCH_PARTIAL', 9],
    ['UNKNOWN', 1]
  ] as const)('%s -> exit %d', (code, expected) => {
    expect(exitCodeForError(new LanhuError(code, 'msg'))).toBe(expected);
  });

  test('non-Lanhu errors map to exit 1', () => {
    expect(exitCodeForError(new Error('boom'))).toBe(1);
    expect(exitCodeForError('boom')).toBe(1);
    expect(exitCodeForError(undefined)).toBe(1);
  });

  test('exit 8 is reserved for --strict escalation', () => {
    expect(EXIT_STRICT).toBe(8);
  });
});
