// Runner M3 extensions: --stdin batch mode (NDJSON envelopes + exit-code
// aggregation, with a mocked stdin), binary stdout, and handler exit codes.
import { LanhuError, makeWarning } from '@lanhu-context/core';

const stdinContent = { value: '' };
vi.mock('../io/stdin', () => ({
  readStdin: async () => stdinContent.value
}));

import { Buffer } from 'node:buffer';
import { executeCommand } from '../runner';

interface Captured {
  stdout: string[];
  stderr: string[];
}

let captured: Captured;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

beforeEach(() => {
  process.exitCode = 0;
  stdinContent.value = '';
  Object.defineProperty(process.stdout, 'isTTY', {
    value: false,
    configurable: true
  });
  captured = { stdout: [], stderr: [] };
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: unknown
  ) => {
    captured.stdout.push(
      Buffer.isBuffer(chunk) ? `<buf:${chunk.length}>` : String(chunk)
    );
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
  process.exitCode = 0;
});

function baseArgs(extra: Record<string, unknown> = {}) {
  return { _: [], json: false, quiet: false, ...extra };
}

function ndjsonLines(): Array<Record<string, unknown>> {
  return captured.stdout
    .join('')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

// A batch item handler: lines containing "bad" throw EMPTY_RESULT (exit 4),
// "net" throws UPSTREAM_ERROR (exit 5), everything else succeeds.
async function demoItem(url: string) {
  if (url.includes('bad')) throw new LanhuError('EMPTY_RESULT', `bad: ${url}`);
  if (url.includes('net')) throw new LanhuError('UPSTREAM_ERROR', 'net down');
  return { data: { url } };
}

describe('executeCommand — --stdin batch mode', () => {
  test('emits one envelope per line with an input echo; exit 0 when all ok', async () => {
    stdinContent.value = 'url-1\n\n{"url":"url-2"}\n';
    await executeCommand({
      command: 'meta',
      kind: 'report',
      args: baseArgs({ stdin: true }),
      rawArgs: [],
      handler: async () => ({ data: null }),
      batchItem: demoItem
    });

    const lines = ndjsonLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      ok: true,
      command: 'meta',
      data: { url: 'url-1' },
      input: 'url-1'
    });
    expect(lines[1]).toMatchObject({
      ok: true,
      data: { url: 'url-2' },
      input: '{"url":"url-2"}'
    });
    expect(captured.stderr.join('')).toContain('{"total":2,"ok":2,"failed":0}');
    expect(process.exitCode).toBe(0);
  });

  test('default mode stops at the first failure and exits with its code', async () => {
    stdinContent.value = 'url-1\nbad-url\nurl-3\n';
    await executeCommand({
      command: 'meta',
      kind: 'report',
      args: baseArgs({ stdin: true }),
      rawArgs: [],
      handler: async () => ({ data: null }),
      batchItem: demoItem
    });

    const lines = ndjsonLines();
    expect(lines).toHaveLength(2); // url-3 never ran
    expect(lines[1]).toMatchObject({
      ok: false,
      input: 'bad-url',
      error: { code: 'EMPTY_RESULT' }
    });
    expect(captured.stderr.join('')).toContain('{"total":2,"ok":1,"failed":1}');
    expect(process.exitCode).toBe(4);
  });

  test('--keep-going runs everything; partial failure exits 9', async () => {
    stdinContent.value = 'url-1\nbad-url\nurl-3\n';
    await executeCommand({
      command: 'meta',
      kind: 'report',
      args: baseArgs({ stdin: true, 'keep-going': true }),
      rawArgs: [],
      handler: async () => ({ data: null }),
      batchItem: demoItem
    });

    const lines = ndjsonLines();
    expect(lines).toHaveLength(3);
    expect(lines.map(l => l.ok)).toEqual([true, false, true]);
    expect(captured.stderr.join('')).toContain('{"total":3,"ok":2,"failed":1}');
    expect(process.exitCode).toBe(9);
  });

  test('--keep-going with all entries failing takes the dominant class', async () => {
    stdinContent.value = 'bad-1\nnet-1\nbad-2\n';
    await executeCommand({
      command: 'meta',
      kind: 'report',
      args: baseArgs({ stdin: true, 'keep-going': true }),
      rawArgs: [],
      handler: async () => ({ data: null }),
      batchItem: demoItem
    });
    expect(process.exitCode).toBe(4); // EMPTY_RESULT (4) appears twice, net (5) once
  });

  test('--strict escalates per-item warnings into item failures (exit 8 class)', async () => {
    stdinContent.value = 'warn-url\nok-url\n';
    await executeCommand({
      command: 'meta',
      kind: 'report',
      args: baseArgs({ stdin: true, 'keep-going': true, strict: true }),
      rawArgs: [],
      handler: async () => ({ data: null }),
      batchItem: async (url, ctx) => {
        if (url.includes('warn')) {
          ctx.warnings.push(makeWarning('TOKENS_UNAVAILABLE', 'no tokens'));
        }
        return { data: { url } };
      }
    });

    const lines = ndjsonLines();
    expect(lines[0]).toMatchObject({
      ok: false,
      error: { code: 'TOKENS_UNAVAILABLE' }
    });
    expect(lines[1]).toMatchObject({ ok: true });
    expect(process.exitCode).toBe(9); // one strict failure + one success
  });

  test('--stdin without batch support, or with a positional/--inline, exits 2', async () => {
    for (const setup of [
      { args: baseArgs({ stdin: true }), batch: false },
      { args: baseArgs({ stdin: true, url: 'u' }), batch: true },
      { args: baseArgs({ stdin: true, inline: true }), batch: true }
    ]) {
      process.exitCode = 0;
      captured.stdout = [];
      await executeCommand({
        command: 'schema',
        kind: 'report',
        args: setup.args,
        rawArgs: [],
        handler: async () => ({ data: null }),
        ...(setup.batch ? { batchItem: demoItem } : {})
      });
      expect(process.exitCode).toBe(2);
      const envelope = JSON.parse(captured.stdout.join(''));
      expect(envelope.error.code).toBe('USAGE_ERROR');
    }
  });
});

describe('executeCommand — binary stdout and handler exit codes', () => {
  test('binary artifacts are written raw without a trailing newline', async () => {
    await executeCommand({
      command: 'preview',
      kind: 'artifact',
      args: baseArgs(),
      rawArgs: [],
      handler: async () => ({
        data: { bytes: 4 },
        binary: Buffer.from([0x89, 0x50, 0x4e, 0x47])
      })
    });
    expect(captured.stdout).toEqual(['<buf:4>']);
    expect(process.exitCode).toBe(0);
  });

  test('a successful report can still set a non-zero exit code (doctor)', async () => {
    await executeCommand({
      command: 'doctor',
      kind: 'report',
      args: baseArgs(),
      rawArgs: [],
      handler: async () => ({
        data: { ok: false, checks: [] },
        exitCode: 3
      })
    });
    const envelope = JSON.parse(captured.stdout.join(''));
    expect(envelope.ok).toBe(true);
    expect(envelope.data.ok).toBe(false);
    expect(process.exitCode).toBe(3);
  });
});
