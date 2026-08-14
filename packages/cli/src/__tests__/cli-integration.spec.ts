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

interface CliResult {
  code: number;
  stdout: string;
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
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
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
