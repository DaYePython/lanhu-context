// Runner lifecycle tests: envelope emission per §5 channel rules with the
// TTY branch mocked, failure envelopes on stdout, and --strict escalation.
import { LanhuError, makeWarning } from '@lanhu-context/core';
import { executeCommand } from '../runner';

interface Captured {
  stdout: string[];
  stderr: string[];
}

let captured: Captured;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

function mockTTY(isTTY: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', {
    value: isTTY,
    configurable: true
  });
}

beforeEach(() => {
  process.exitCode = 0;
  captured = { stdout: [], stderr: [] };
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: unknown
  ) => {
    captured.stdout.push(String(chunk));
    return true;
  }) as never);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((
    chunk: unknown
  ) => {
    captured.stderr.push(String(chunk));
    return true;
  }) as never);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  if (originalIsTTY) {
    Object.defineProperty(process.stdout, 'isTTY', originalIsTTY);
  }
  // The runner sets process.exitCode on failures; reset so the test process
  // itself exits cleanly.
  process.exitCode = 0;
});

function baseArgs(extra: Record<string, unknown> = {}) {
  return { _: [], json: false, quiet: true, ...extra };
}

function stdoutText(): string {
  return captured.stdout.join('');
}

describe('executeCommand — report commands', () => {
  test('TTY without --json renders human output on stdout', async () => {
    mockTTY(true);
    await executeCommand({
      command: 'parse',
      kind: 'report',
      args: baseArgs(),
      rawArgs: [],
      handler: async () => ({
        data: { imageId: 'i1' },
        render: () => 'imageId  i1'
      })
    });
    expect(stdoutText()).toBe('imageId  i1\n');
    expect(process.exitCode).toBe(0);
  });

  test('piped stdout auto-enables the JSON envelope', async () => {
    mockTTY(false);
    await executeCommand({
      command: 'parse',
      kind: 'report',
      args: baseArgs(),
      rawArgs: [],
      handler: async () => ({
        data: { imageId: 'i1' },
        render: () => 'human'
      })
    });
    const envelope = JSON.parse(stdoutText());
    expect(envelope).toMatchObject({
      ok: true,
      command: 'parse',
      data: { imageId: 'i1' },
      warnings: []
    });
    expect(envelope.meta.version).toBeTruthy();
  });
});

describe('executeCommand — artifact commands', () => {
  test('piped stdout still emits the raw artifact (no auto-JSON)', async () => {
    mockTTY(false);
    await executeCommand({
      command: 'html',
      kind: 'artifact',
      args: baseArgs(),
      rawArgs: [],
      handler: async () => ({
        data: { html: '<div/>' },
        artifact: '<div class="x"></div>'
      })
    });
    expect(stdoutText()).toBe('<div class="x"></div>\n');
  });

  test('explicit --json switches the artifact into an envelope', async () => {
    mockTTY(false);
    await executeCommand({
      command: 'html',
      kind: 'artifact',
      args: baseArgs({ json: true }),
      rawArgs: [],
      handler: async () => ({
        data: { html: '<div/>' },
        artifact: '<div/>'
      })
    });
    const envelope = JSON.parse(stdoutText());
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({ html: '<div/>' });
  });
});

describe('executeCommand — failures', () => {
  test('failure envelope goes to stdout in JSON mode with the mapped exit code', async () => {
    mockTTY(false);
    await executeCommand({
      command: 'parse',
      kind: 'report',
      args: baseArgs(),
      rawArgs: [],
      handler: async () => {
        throw new LanhuError('EMPTY_RESULT', 'null payload');
      }
    });
    const envelope = JSON.parse(stdoutText());
    expect(envelope).toMatchObject({
      ok: false,
      command: 'parse',
      error: { code: 'EMPTY_RESULT', retryable: false }
    });
    expect(process.exitCode).toBe(4);
  });

  test('artifact failure without --json keeps stdout empty (stderr + exit code only)', async () => {
    mockTTY(false);
    await executeCommand({
      command: 'schema',
      kind: 'artifact',
      args: baseArgs(),
      rawArgs: [],
      handler: async () => {
        throw new LanhuError('TOKEN_MISSING', 'no token');
      }
    });
    expect(stdoutText()).toBe('');
    expect(captured.stderr.join('')).toContain('TOKEN_MISSING');
    expect(process.exitCode).toBe(3);
  });

  test('preValidate usage conflicts exit 2 before any work happens', async () => {
    mockTTY(false);
    const handler = vi.fn();
    await executeCommand({
      command: 'context',
      kind: 'artifact',
      args: baseArgs({ inline: true, json: true }),
      rawArgs: [],
      preValidate: () => {
        throw new LanhuError('USAGE_ERROR', 'inline conflicts with json');
      },
      handler: handler as never
    });
    expect(handler).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });
});

describe('executeCommand — --strict escalation', () => {
  test('warnings escalate to exit 8 with a strict failure envelope', async () => {
    mockTTY(false);
    await executeCommand({
      command: 'html',
      kind: 'report',
      args: baseArgs({ strict: true }),
      rawArgs: [],
      handler: async ctx => {
        ctx.warnings.push(makeWarning('TAILWIND_FALLBACK', 'tw failed'));
        return { data: { html: '<div/>' } };
      }
    });
    const envelope = JSON.parse(stdoutText());
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('TAILWIND_FALLBACK');
    expect(process.exitCode).toBe(8);
  });

  test('without --strict the same warnings stay in a successful envelope', async () => {
    mockTTY(false);
    await executeCommand({
      command: 'html',
      kind: 'report',
      args: baseArgs(),
      rawArgs: [],
      handler: async ctx => {
        ctx.warnings.push(makeWarning('TAILWIND_FALLBACK', 'tw failed'));
        return { data: { html: '<div/>' } };
      }
    });
    const envelope = JSON.parse(stdoutText());
    expect(envelope.ok).toBe(true);
    expect(envelope.warnings).toHaveLength(1);
    expect(envelope.warnings[0].code).toBe('TAILWIND_FALLBACK');
    expect(process.exitCode).toBe(0);
  });
});
