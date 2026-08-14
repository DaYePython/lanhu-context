// User-level config tests (DESIGN.md §7): XDG path resolution across
// platforms and 0600 read/write round-trips — all inside temp dirs, never
// the real user directory.
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LanhuError } from '@lanhu-context/core';
import {
  readUserConfig,
  resolveUserConfigPath,
  writeUserConfig
} from '../config/user-config';

let dirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanhu-user-config-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('resolveUserConfigPath — XDG rules', () => {
  test('$XDG_CONFIG_HOME wins on every platform', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(
        resolveUserConfigPath({
          env: { XDG_CONFIG_HOME: '/xdg' },
          platform,
          homedir: () => '/home/u'
        })
      ).toBe(join('/xdg', 'lanhu', 'config.json'));
    }
  });

  test('macOS/Linux fall back to ~/.config/lanhu/config.json', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(
        resolveUserConfigPath({ env: {}, platform, homedir: () => '/home/u' })
      ).toBe(join('/home/u', '.config', 'lanhu', 'config.json'));
    }
  });

  test('win32 uses %APPDATA%\\lanhu\\config.json (with home fallback)', () => {
    expect(
      resolveUserConfigPath({
        env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' },
        platform: 'win32',
        homedir: () => 'C:\\Users\\u'
      })
    ).toBe(join('C:\\Users\\u\\AppData\\Roaming', 'lanhu', 'config.json'));

    expect(
      resolveUserConfigPath({
        env: {},
        platform: 'win32',
        homedir: () => 'C:\\Users\\u'
      })
    ).toBe(join('C:\\Users\\u', 'AppData', 'Roaming', 'lanhu', 'config.json'));
  });
});

describe('readUserConfig / writeUserConfig', () => {
  test('write creates parent dirs and sets 0600; read round-trips', () => {
    const dir = makeTmpDir();
    const path = join(dir, 'nested', 'lanhu', 'config.json');
    writeUserConfig(path, { lanhuToken: 'tok-1' });

    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(readUserConfig(path)).toEqual({ lanhuToken: 'tok-1' });
  });

  test('write merges with the existing file and re-enforces 0600', () => {
    const dir = makeTmpDir();
    const path = join(dir, 'config.json');
    writeUserConfig(path, { lanhuToken: 'tok-1', lang: 'zh-CN' });
    writeUserConfig(path, { ddsToken: 'dds-1' });

    expect(readUserConfig(path)).toEqual({
      lanhuToken: 'tok-1',
      lang: 'zh-CN',
      ddsToken: 'dds-1'
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test('missing file reads as {}; invalid JSON is CONFIG_INVALID', () => {
    const dir = makeTmpDir();
    expect(readUserConfig(join(dir, 'nope.json'))).toEqual({});

    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{oops');
    try {
      readUserConfig(broken);
      throw new Error('expected CONFIG_INVALID');
    } catch (error) {
      expect(error).toBeInstanceOf(LanhuError);
      expect((error as LanhuError).code).toBe('CONFIG_INVALID');
    }
  });
});
