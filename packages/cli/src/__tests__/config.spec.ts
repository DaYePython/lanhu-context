// Config layer tests (DESIGN.md §7, M2 scope):
// CLI flag > process env > env file (--env-file > ENV_FILE > cwd/.env.local)
// > defaults, with --cwd applied before env loading.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LanhuError } from '@lanhu-context/core';
import {
  DEFAULT_RETRIES,
  type ProcessIo,
  requireToken,
  resolveConfig
} from '../config/index';

let dirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanhu-cli-config-'));
  dirs.push(dir);
  return dir;
}

function fakeIo(
  initialCwd: string,
  env: Record<string, string> = {}
): ProcessIo & { cwd(): string } {
  let cwd = initialCwd;
  return {
    env,
    getCwd: () => cwd,
    chdir: dir => {
      cwd = dir;
    },
    cwd: () => cwd
  };
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('resolveConfig — precedence', () => {
  test('flag > process env > env file for LANHU_TOKEN', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, '.env.local'), 'LANHU_TOKEN=from-file\n');

    // env file only
    let config = resolveConfig({}, fakeIo(dir));
    expect(config.token).toBe('from-file');
    expect(config.tokenSource).toBe('env-file');

    // process env beats env file
    config = resolveConfig({}, fakeIo(dir, { LANHU_TOKEN: 'from-env' }));
    expect(config.token).toBe('from-env');
    expect(config.tokenSource).toBe('env');

    // flag beats everything
    config = resolveConfig(
      { token: 'from-flag' },
      fakeIo(dir, { LANHU_TOKEN: 'from-env' })
    );
    expect(config.token).toBe('from-flag');
    expect(config.tokenSource).toBe('flag');
  });

  test('DDS_TOKEN follows the same chain and stays optional', () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, '.env.local'),
      'LANHU_TOKEN=t\nDDS_TOKEN=dds-file\n'
    );
    expect(resolveConfig({}, fakeIo(dir)).ddsToken).toBe('dds-file');
    expect(
      resolveConfig({}, fakeIo(dir, { DDS_TOKEN: 'dds-env' })).ddsToken
    ).toBe('dds-env');
    expect(resolveConfig({ ddsToken: 'dds-flag' }, fakeIo(dir)).ddsToken).toBe(
      'dds-flag'
    );
    expect(resolveConfig({}, fakeIo(makeTmpDir())).ddsToken).toBeUndefined();
  });

  test('defaults: timeout 30000, retries 2, lang en-US, no token', () => {
    const dir = makeTmpDir();
    const config = resolveConfig({}, fakeIo(dir));
    expect(config.timeout).toBe(30_000);
    expect(config.retries).toBe(DEFAULT_RETRIES);
    expect(config.lang).toBe('en-US');
    expect(config.token).toBeUndefined();
    expect(config.envFilePath).toBeUndefined();
  });
});

describe('resolveConfig — env file selection', () => {
  test('--env-file wins over ENV_FILE and cwd/.env.local', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, '.env.local'), 'LANHU_TOKEN=default-file\n');
    writeFileSync(join(dir, 'ci.env'), 'LANHU_TOKEN=ci-file\n');
    writeFileSync(join(dir, 'other.env'), 'LANHU_TOKEN=other-file\n');

    const viaFlag = resolveConfig(
      { envFile: 'ci.env' },
      fakeIo(dir, { ENV_FILE: 'other.env' })
    );
    expect(viaFlag.token).toBe('ci-file');
    expect(viaFlag.envFilePath).toBe(join(dir, 'ci.env'));

    const viaEnvVar = resolveConfig({}, fakeIo(dir, { ENV_FILE: 'other.env' }));
    expect(viaEnvVar.token).toBe('other-file');
  });

  test('an explicitly requested env file must exist (CONFIG_INVALID, exit 3)', () => {
    const dir = makeTmpDir();
    try {
      resolveConfig({ envFile: 'missing.env' }, fakeIo(dir));
      throw new Error('expected CONFIG_INVALID');
    } catch (error) {
      expect(error).toBeInstanceOf(LanhuError);
      expect((error as LanhuError).code).toBe('CONFIG_INVALID');
      expect((error as LanhuError).exitClass).toBe(3);
    }
  });

  test('the default cwd/.env.local is optional', () => {
    const dir = makeTmpDir();
    expect(() => resolveConfig({}, fakeIo(dir))).not.toThrow();
  });
});

describe('resolveConfig — --cwd', () => {
  test('chdir happens before env loading so <cwd>/.env.local is found', () => {
    const outer = makeTmpDir();
    const inner = join(outer, 'project');
    mkdirSync(inner);
    writeFileSync(join(inner, '.env.local'), 'LANHU_TOKEN=inner-file\n');

    const io = fakeIo(outer);
    const config = resolveConfig({ cwd: 'project' }, io);
    expect(io.cwd()).toBe(inner);
    expect(config.cwd).toBe(inner);
    expect(config.token).toBe('inner-file');
    expect(config.tokenSource).toBe('env-file');
  });

  test('a non-existent --cwd is CONFIG_INVALID (exit 3)', () => {
    const dir = makeTmpDir();
    try {
      resolveConfig({ cwd: 'no-such-dir' }, fakeIo(dir));
      throw new Error('expected CONFIG_INVALID');
    } catch (error) {
      expect(error).toBeInstanceOf(LanhuError);
      expect((error as LanhuError).code).toBe('CONFIG_INVALID');
      expect((error as LanhuError).exitClass).toBe(3);
    }
  });
});

describe('resolveConfig — numeric and lang validation', () => {
  test('invalid --timeout / --retries are usage errors (exit 2)', () => {
    const dir = makeTmpDir();
    for (const flags of [
      { timeout: 'abc' },
      { timeout: '0' },
      { retries: '-1' },
      { retries: '1.5' }
    ]) {
      try {
        resolveConfig(flags, fakeIo(dir));
        throw new Error(`expected USAGE_ERROR for ${JSON.stringify(flags)}`);
      } catch (error) {
        expect(error).toBeInstanceOf(LanhuError);
        expect((error as LanhuError).code).toBe('USAGE_ERROR');
        expect((error as LanhuError).exitClass).toBe(2);
      }
    }
  });

  test('valid --timeout / --retries are parsed', () => {
    const dir = makeTmpDir();
    const config = resolveConfig(
      { timeout: '5000', retries: '0' },
      fakeIo(dir)
    );
    expect(config.timeout).toBe(5000);
    expect(config.retries).toBe(0);
  });

  test('--lang validates strictly; PROMPT_LANG env coerces leniently', () => {
    const dir = makeTmpDir();
    expect(resolveConfig({ lang: 'zh-CN' }, fakeIo(dir)).lang).toBe('zh-CN');
    expect(resolveConfig({}, fakeIo(dir, { PROMPT_LANG: 'zh-CN' })).lang).toBe(
      'zh-CN'
    );
    expect(resolveConfig({}, fakeIo(dir, { PROMPT_LANG: 'weird' })).lang).toBe(
      'en-US'
    );
    expect(() => resolveConfig({ lang: 'fr-FR' }, fakeIo(dir))).toThrow(
      LanhuError
    );
  });
});

describe('requireToken', () => {
  test('throws TOKEN_MISSING (exit 3) with a .env.local hint', () => {
    const dir = makeTmpDir();
    const config = resolveConfig({}, fakeIo(dir));
    try {
      requireToken(config);
      throw new Error('expected TOKEN_MISSING');
    } catch (error) {
      expect(error).toBeInstanceOf(LanhuError);
      expect((error as LanhuError).code).toBe('TOKEN_MISSING');
      expect((error as LanhuError).exitClass).toBe(3);
      expect((error as LanhuError).hint).toContain('.env.local');
      expect((error as LanhuError).hint).toContain('lanhu auth set');
    }
  });

  test('returns the resolved token when present', () => {
    const dir = makeTmpDir();
    const config = resolveConfig({ token: 'tok' }, fakeIo(dir));
    expect(requireToken(config)).toBe('tok');
  });
});
