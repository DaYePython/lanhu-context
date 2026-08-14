// stdout channel rules (DESIGN.md §5): report vs artifact commands and the
// auto-JSON switch, including the TTY / pipe branches.
import { shouldEmitJson } from '../io/output';

describe('shouldEmitJson — §5 channel matrix', () => {
  test.each([
    // kind, explicit --json, stdout isTTY, expected
    ['report', false, true, false], // TTY human rendering
    ['report', false, false, true], // piped report auto-enables JSON
    ['report', true, true, true],
    ['report', true, false, true],
    ['artifact', false, true, false], // artifact always raw...
    ['artifact', false, false, false], // ...even when piped (§4.4 pipelines)
    ['artifact', true, true, true], // explicit --json switches to envelope
    ['artifact', true, false, true]
  ] as const)('kind=%s json=%s tty=%s -> %s', (kind, json, tty, expected) => {
    expect(shouldEmitJson(kind, json, tty)).toBe(expected);
  });
});
