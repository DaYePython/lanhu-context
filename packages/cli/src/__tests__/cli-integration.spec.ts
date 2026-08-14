// End-to-end integration tests for the built CLI (DESIGN.md §11 M2 DoD).
// Opt-in only:
//
//   pnpm -r build && RUN_INTEGRATION=1 pnpm vitest run cli-integration
//
// Spawns the real bin (dist/main.js) so exit codes and stdout/stderr
// separation are asserted against the actual process contract. Reads
// LANHU_TOKEN / LANHU_TEST_URL from process.env or the repo-root .env.local.
// Token values are passed via child env only and never printed.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../dist/main.js', import.meta.url));

function loadEnvLocal(): Record<string, string> {
  const envPath = fileURLToPath(
    new URL('../../../../.env.local', import.meta.url)
  );
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const enabled = process.env.RUN_INTEGRATION === '1';
const envFile = enabled ? loadEnvLocal() : {};
const lanhuToken = process.env.LANHU_TOKEN || envFile.LANHU_TOKEN || '';
const ddsToken = process.env.DDS_TOKEN || envFile.DDS_TOKEN || '';
const testUrl = process.env.LANHU_TEST_URL || envFile.LANHU_TEST_URL || '';
// A real design uploaded WITHOUT「设计图转代码」— only ever provided via env
// (it contains private project ids and must never be hardcoded).
const untranscodedUrl =
  process.env.LANHU_UNTRANSCODED_URL || envFile.LANHU_UNTRANSCODED_URL || '';

interface CliResult {
  code: number;
  stdout: string;
  /** Raw stdout bytes (for binary artifacts like `preview -o -`). */
  stdoutBuf: Buffer;
  stderr: string;
}

// Base child env: strip Lanhu credentials so each case opts in explicitly,
// and run inside a temp cwd so the repo-root .env.local is never picked up.
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const key of ['LANHU_TOKEN', 'DDS_TOKEN', 'ENV_FILE', 'PROMPT_LANG']) {
    if (!(key in extra)) delete env[key];
  }
  return env;
}

function runCli(
  args: string[],
  options: {
    env?: Record<string, string>;
    cwd?: string;
    input?: string;
  } = {}
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: options.cwd ?? workDir,
      env: childEnv(options.env ?? {}),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      const stdoutBuf = Buffer.concat(stdout);
      resolve({
        code: code ?? -1,
        stdout: stdoutBuf.toString('utf8'),
        stdoutBuf,
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

const withToken = {
  LANHU_TOKEN: lanhuToken,
  ...(ddsToken ? { DDS_TOKEN: ddsToken } : {})
};

let workDir = tmpdir();

describe.runIf(enabled)('CLI integration (RUN_INTEGRATION=1)', () => {
  beforeAll(() => {
    expect(
      existsSync(BIN),
      'packages/cli/dist/main.js missing — run `pnpm -r build` first'
    ).toBe(true);
    expect(lanhuToken, 'LANHU_TOKEN missing in env/.env.local').toBeTruthy();
    expect(testUrl, 'LANHU_TEST_URL missing in env/.env.local').toBeTruthy();
    workDir = mkdtempSync(join(tmpdir(), 'lanhu-cli-int-'));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // §4.4 pipeline example 1+2: schema to a file, then offline html from stdin.
  test('pipeline: schema "$URL" -> html - --tailwind --tw-version 4 (offline, no token)', async () => {
    const schemaRun = await runCli(['schema', testUrl], { env: withToken });
    expect(schemaRun.code).toBe(0);
    expect(schemaRun.stdout.length).toBeGreaterThan(100);
    const schemaJson = JSON.parse(schemaRun.stdout); // raw artifact, not an envelope
    expect(schemaJson.ok).toBeUndefined();

    // html - runs fully offline: no token in env proves no API access.
    const htmlRun = await runCli(
      ['html', '-', '--tailwind', '--tw-version', '4'],
      { input: schemaRun.stdout }
    );
    expect(htmlRun.code).toBe(0);
    expect(htmlRun.stdout.length).toBeGreaterThan(0);
    expect(
      htmlRun.stdout.includes('<html') || htmlRun.stdout.includes('<div')
    ).toBe(true);
  }, 120_000);

  // Exit 0 + §5: report command auto-JSON when stdout is piped.
  test('exit 0: parse auto-enables the JSON envelope without a TTY', async () => {
    const result = await runCli(['parse', testUrl]);
    expect(result.code).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('parse');
    expect(envelope.data.teamId).toBeTruthy();
    expect(envelope.data.projectId).toBeTruthy();
    expect(envelope.data.imageId).toBeTruthy();
    expect(envelope.meta.version).toBeTruthy();
  });

  // Exit 2: broken URL. Failure envelope goes to stdout (auto-JSON, no TTY).
  test('exit 2: bad URL yields a failure envelope on stdout', async () => {
    const result = await runCli(['parse', 'pid=p1&image_id=i1']);
    expect(result.code).toBe(2);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('URL_MISSING_TID');
    expect(envelope.error.hint.length).toBeGreaterThan(10);
    expect(result.stderr).toContain('URL_MISSING_TID');
  });

  // Exit 3: token cleared from env, temp cwd has no .env.local.
  test('exit 3: schema without any token is TOKEN_MISSING', async () => {
    const result = await runCli(['schema', testUrl, '--json']);
    expect(result.code).toBe(3);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('TOKEN_MISSING');
  });

  // Exit 4: a syntactically valid but forged token -> empty payload.
  test('exit 4: forged token is rejected as EMPTY_RESULT/AUTH', async () => {
    const result = await runCli(['schema', testUrl, '--json'], {
      env: { LANHU_TOKEN: 'session=forged-cookie-value' }
    });
    expect(result.code).toBe(4);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(false);
    expect(['EMPTY_RESULT', 'AUTH_EXPIRED', 'ACCESS_DENIED']).toContain(
      envelope.error.code
    );
  }, 60_000);

  // Exit 4: a design uploaded without「设计图转代码」— meta is fine, but the
  // DDS schema endpoint answers HTTP 200 + empty data (code 10011). Skipped
  // unless LANHU_UNTRANSCODED_URL is provided via env/.env.local.
  test.skipIf(!untranscodedUrl)(
    'exit 4: design without 设计图转代码 is TRANSCODE_NOT_ENABLED',
    async () => {
      const result = await runCli(['schema', untranscodedUrl, '--json'], {
        env: withToken
      });
      expect(result.code).toBe(4);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe('TRANSCODE_NOT_ENABLED');
      expect(envelope.error.retryable).toBe(false);
      expect(envelope.error.hint).toContain('设计图转代码');
    },
    60_000
  );

  // Exit 5: real token but an impossible timeout -> retryable upstream error.
  test('exit 5: 1ms timeout surfaces UPSTREAM_TIMEOUT after retries', async () => {
    const result = await runCli(
      ['schema', testUrl, '--json', '--timeout', '1', '--retries', '1'],
      { env: withToken }
    );
    expect(result.code).toBe(5);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(false);
    expect(['UPSTREAM_TIMEOUT', 'UPSTREAM_ERROR']).toContain(
      envelope.error.code
    );
    expect(envelope.error.retryable).toBe(true);
  }, 60_000);

  // §5: artifact streams stay raw when piped; --json is the only switch.
  test('output contract: piped schema emits the raw artifact, --json the envelope', async () => {
    const raw = await runCli(['schema', testUrl], { env: withToken });
    expect(raw.code).toBe(0);
    expect(JSON.parse(raw.stdout).ok).toBeUndefined();

    const json = await runCli(['schema', testUrl, '--json'], {
      env: withToken
    });
    expect(json.code).toBe(0);
    const envelope = JSON.parse(json.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('schema');
    expect(envelope.data.schema).toBeTruthy();
  }, 120_000);

  // context files mode: report envelope + idempotent re-run.
  test('context writes context.md (+preview) and re-runs as skipped', async () => {
    const outDir = join(workDir, 'ctx-out');
    const first = await runCli(['context', testUrl, '--out-dir', outDir], {
      env: withToken
    });
    expect(first.code).toBe(0);
    const envelope = JSON.parse(first.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('context');
    const contextFile = envelope.data.files.find(
      (f: { type: string }) => f.type === 'context'
    );
    expect(contextFile.status).toBe('written');
    expect(existsSync(contextFile.path)).toBe(true);
    expect(readFileSync(contextFile.path, 'utf8')).toContain('<style>');

    const second = await runCli(['context', testUrl, '--out-dir', outDir], {
      env: withToken
    });
    expect(second.code).toBe(0);
    const envelope2 = JSON.parse(second.stdout);
    for (const file of envelope2.data.files) {
      expect(file.status).toBe('skipped');
    }
  }, 240_000);

  // context --inline: artifact stream on stdout, summary on stderr.
  test('context --inline streams the context body; --inline --json exits 2', async () => {
    const inline = await runCli(['context', testUrl, '--inline'], {
      env: withToken
    });
    expect(inline.code).toBe(0);
    expect(inline.stdout).toContain('<style>');
    expect(inline.stdout.length).toBeGreaterThan(500);
    expect(inline.stderr).toContain('bytes');

    const conflict = await runCli(['context', testUrl, '--inline', '--json'], {
      env: withToken
    });
    expect(conflict.code).toBe(2);
  }, 240_000);
});

// --- M3: meta/tokens/assets/preview/auth/doctor (§11 M3 DoD) ---
describe.runIf(enabled)('CLI integration M3 (RUN_INTEGRATION=1)', () => {
  let m3Dir = tmpdir();

  beforeAll(() => {
    m3Dir = mkdtempSync(join(tmpdir(), 'lanhu-cli-m3-'));
    // The M2 block's afterAll removed its workDir; spawn cwd must exist.
    workDir = m3Dir;
  });

  afterAll(() => {
    rmSync(m3Dir, { recursive: true, force: true });
  });

  // §11 M3 DoD: every command's --help contains runnable examples.
  test('every command --help shows runnable examples', async () => {
    const commands = [
      ['parse'],
      ['meta'],
      ['schema'],
      ['html'],
      ['tokens'],
      ['assets'],
      ['preview'],
      ['context'],
      ['auth'],
      ['auth', 'set'],
      ['auth', 'status'],
      ['auth', 'test'],
      ['doctor']
    ];
    for (const command of commands) {
      const result = await runCli([...command, '--help']);
      expect(result.code, command.join(' ')).toBe(0);
      const text = result.stdout + result.stderr;
      expect(text, `${command.join(' ')} --help`).toContain('示例');
      expect(text, `${command.join(' ')} --help`).toContain('lanhu ');
    }
  }, 120_000);

  test('meta reports name/imageId/previewUrl/versions summary', async () => {
    const result = await runCli(['meta', testUrl, '--json'], {
      env: withToken
    });
    expect(result.code).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.name).toBeTruthy();
    expect(envelope.data.imageId).toBeTruthy();
    expect(envelope.data.versions.count).toBeGreaterThanOrEqual(0);
  }, 60_000);

  test('tokens streams entries as JSON and CSS variables', async () => {
    const jsonRun = await runCli(['tokens', testUrl], { env: withToken });
    expect(jsonRun.code).toBe(0);
    const entries = JSON.parse(jsonRun.stdout);
    expect(Array.isArray(entries)).toBe(true);

    const cssRun = await runCli(['tokens', testUrl, '--format', 'css'], {
      env: withToken
    });
    expect(cssRun.code).toBe(0);
    expect(cssRun.stdout).toContain(':root {');
  }, 120_000);

  // §11 M3 DoD: assets --download re-run is fully idempotent (all skipped).
  test('assets --download twice: second run is all skipped', async () => {
    const outDir = join(m3Dir, 'slices');
    const args = ['assets', testUrl, '--download', '-o', outDir, '--json'];
    const first = await runCli(args, { env: withToken });
    expect(first.code).toBe(0);
    const envelope1 = JSON.parse(first.stdout);
    expect(envelope1.ok).toBe(true);
    expect(envelope1.data.summary.failed).toBe(0);
    expect(envelope1.data.summary.written).toBe(envelope1.data.summary.total);

    const second = await runCli(args, { env: withToken });
    expect(second.code).toBe(0);
    const envelope2 = JSON.parse(second.stdout);
    expect(envelope2.data.summary.skipped).toBe(envelope2.data.summary.total);
    expect(envelope2.data.summary.written).toBe(0);
    expect(envelope2.data.summary.overwritten).toBe(0);
  }, 240_000);

  // §11 M3 DoD: preview lands as a real PNG (magic bytes), idempotently.
  test('preview -o <file> writes a valid PNG; -o - streams raw bytes', async () => {
    const file = join(m3Dir, 'preview.png');
    const result = await runCli(['preview', testUrl, '-o', file, '--json'], {
      env: withToken
    });
    expect(result.code).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.status).toBe('written');
    const magic = readFileSync(file).subarray(0, 4);
    expect([...magic]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    // -o -: PNG bytes on stdout, no envelope.
    const streamed = await runCli(['preview', testUrl, '-o', '-'], {
      env: withToken
    });
    expect(streamed.code).toBe(0);
    expect([...streamed.stdoutBuf.subarray(0, 4)]).toEqual([
      0x89, 0x50, 0x4e, 0x47
    ]);

    // second file run: skipped (content hash identical).
    const again = await runCli(['preview', testUrl, '-o', file, '--json'], {
      env: withToken
    });
    expect(JSON.parse(again.stdout).data.status).toBe('skipped');
  }, 240_000);

  // §11 M3 DoD: auth 三件套 against the real API.
  test('auth set --token-stdin + status + test round-trip', async () => {
    const xdg = join(m3Dir, 'xdg');
    const env = { XDG_CONFIG_HOME: xdg };

    const set = await runCli(['auth', 'set', '--token-stdin', '--json'], {
      env,
      input: `${lanhuToken}\n`
    });
    expect(set.code).toBe(0);
    const setEnvelope = JSON.parse(set.stdout);
    expect(setEnvelope.data.updated).toEqual(['LANHU_TOKEN']);
    // the token value never leaks into any stream
    expect(set.stdout).not.toContain(lanhuToken);
    expect(set.stderr).not.toContain(lanhuToken);

    const status = await runCli(['auth', 'status', '--json'], { env });
    expect(status.code).toBe(0);
    const statusEnvelope = JSON.parse(status.stdout);
    expect(statusEnvelope.data.token.configured).toBe(true);
    expect(statusEnvelope.data.token.source).toBe('user-config');
    expect(status.stdout).not.toContain(lanhuToken);

    // auth test uses the user-config credential written above.
    const test_ = await runCli(['auth', 'test', testUrl, '--json'], { env });
    expect(test_.code).toBe(0);
    const testEnvelope = JSON.parse(test_.stdout);
    expect(testEnvelope.data.ok).toBe(true);
    expect(testEnvelope.data.checkedAt).toBeTruthy();
  }, 120_000);

  test('doctor passes with a configured token (exit 0)', async () => {
    const result = await runCli(['doctor', '--json'], { env: withToken });
    expect(result.code).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.ok).toBe(true);
    expect(envelope.data.checks.length).toBeGreaterThanOrEqual(6);
  }, 60_000);
});
