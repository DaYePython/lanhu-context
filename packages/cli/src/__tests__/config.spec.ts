// Config layer tests (DESIGN.md §7, M3 scope):
// CLI flag > process env > env file (--env-file > ENV_FILE > cwd/.env.local)
// > lanhu.config.json (project) > user config.json > defaults, with --cwd
// applied before env loading.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LanhuError } from '@lanhu-context/core';
import {
  DEFAULT_RETRIES,
  maskSecret,
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
    // Isolate the user-config layer into a temp dir unless a test injects
    // its own XDG_CONFIG_HOME — never touch the real user config.
    env: { XDG_CONFIG_HOME: makeTmpDir(), ...env },
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

describe('resolveConfig — project & user config layers (M3)', () => {
  test('env file > lanhu.config.json > user config.json for tokens', () => {
    const dir = makeTmpDir();
    const xdg = makeTmpDir();
    mkdirSync(join(xdg, 'lanhu'), { recursive: true });
    writeFileSync(
      join(xdg, 'lanhu', 'config.json'),
      JSON.stringify({ lanhuToken: 'from-user', ddsToken: 'dds-user' })
    );
    const io = () => fakeIo(dir, { XDG_CONFIG_HOME: xdg });

    // user config only
    let config = resolveConfig({}, io());
    expect(config.token).toBe('from-user');
    expect(config.tokenSource).toBe('user-config');
    expect(config.ddsToken).toBe('dds-user');
    expect(config.ddsTokenSource).toBe('user-config');
    expect(config.userConfigPath).toBe(join(xdg, 'lanhu', 'config.json'));
    expect(config.userConfigExists).toBe(true);

    // project config beats user config
    writeFileSync(
      join(dir, 'lanhu.config.json'),
      JSON.stringify({ lanhuToken: 'from-project' })
    );
    config = resolveConfig({}, io());
    expect(config.token).toBe('from-project');
    expect(config.tokenSource).toBe('project-config');
    expect(config.projectConfigPath).toBe(join(dir, 'lanhu.config.json'));
    // dds falls through to the user layer
    expect(config.ddsTokenSource).toBe('user-config');

    // env file beats project config
    writeFileSync(join(dir, '.env.local'), 'LANHU_TOKEN=from-file\n');
    config = resolveConfig({}, io());
    expect(config.token).toBe('from-file');
    expect(config.tokenSource).toBe('env-file');

    // process env beats env file; flag beats everything
    config = resolveConfig(
      {},
      fakeIo(dir, {
        XDG_CONFIG_HOME: xdg,
        LANHU_TOKEN: 'from-env'
      })
    );
    expect(config.tokenSource).toBe('env');
    config = resolveConfig({ token: 'from-flag' }, io());
    expect(config.tokenSource).toBe('flag');
  });

  test('timeout/retries/lang fall back through project and user configs', () => {
    const dir = makeTmpDir();
    const xdg = makeTmpDir();
    mkdirSync(join(xdg, 'lanhu'), { recursive: true });
    writeFileSync(
      join(xdg, 'lanhu', 'config.json'),
      JSON.stringify({ timeout: 1000, retries: 5, lang: 'zh-CN' })
    );
    const io = () => fakeIo(dir, { XDG_CONFIG_HOME: xdg });

    let config = resolveConfig({}, io());
    expect(config.timeout).toBe(1000);
    expect(config.retries).toBe(5);
    expect(config.lang).toBe('zh-CN');

    writeFileSync(
      join(dir, 'lanhu.config.json'),
      JSON.stringify({ timeout: 2000 })
    );
    config = resolveConfig({}, io());
    expect(config.timeout).toBe(2000); // project beats user
    expect(config.retries).toBe(5); // user still fills the gap

    // flags beat both layers
    config = resolveConfig({ timeout: '3000', lang: 'en-US' }, io());
    expect(config.timeout).toBe(3000);
    expect(config.lang).toBe('en-US');
  });

  test('a broken project or user config is CONFIG_INVALID (exit 3)', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'lanhu.config.json'), '{not json');
    expect(() => resolveConfig({}, fakeIo(dir))).toThrowError(
      expect.objectContaining({ code: 'CONFIG_INVALID' })
    );

    const dir2 = makeTmpDir();
    const xdg = makeTmpDir();
    mkdirSync(join(xdg, 'lanhu'), { recursive: true });
    writeFileSync(join(xdg, 'lanhu', 'config.json'), '[]');
    expect(() =>
      resolveConfig({}, fakeIo(dir2, { XDG_CONFIG_HOME: xdg }))
    ).toThrowError(expect.objectContaining({ code: 'CONFIG_INVALID' }));
  });

  test('LANHU_TEST_URL is surfaced from env or env file for `auth test`', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, '.env.local'), 'LANHU_TEST_URL=tid=a&pid=b\n');
    expect(resolveConfig({}, fakeIo(dir)).testUrl).toBe('tid=a&pid=b');
    expect(
      resolveConfig({}, fakeIo(dir, { LANHU_TEST_URL: 'tid=x&pid=y' })).testUrl
    ).toBe('tid=x&pid=y');
  });
});

describe('maskSecret', () => {
  test('long secrets show first/last 4 chars + length, never the value', () => {
    const secret = 'session=super-secret-cookie-value-123456';
    const masked = maskSecret(secret);
    expect(masked).toBe(`sess…3456 (length ${secret.length})`);
    expect(masked).not.toContain('super-secret');
  });

  test('short secrets reveal nothing but the length', () => {
    expect(maskSecret('shorty')).toBe('**** (length 6)');
    expect(maskSecret('elevenchars')).toBe('**** (length 11)');
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
