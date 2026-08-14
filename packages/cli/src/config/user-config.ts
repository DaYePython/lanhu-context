// User-level configuration (DESIGN.md §7):
//   $XDG_CONFIG_HOME/lanhu/config.json
//   > (macOS/Linux) ~/.config/lanhu/config.json
//   > (win32) %APPDATA%\lanhu\config.json
//
// Written by `lanhu auth set` with file mode 0600 (credentials live here).
// All path inputs are injectable so tests never touch the real user config.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { dirname, join } from 'node:path';
import { LanhuError } from '@lanhu-context/core';

export interface UserConfigData {
  lanhuToken?: string;
  ddsToken?: string;
  lang?: string;
  timeout?: number;
  retries?: number;
}

export interface UserConfigPathIo {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  homedir?: () => string;
}

export function resolveUserConfigPath(io: UserConfigPathIo = {}): string {
  const env = io.env ?? process.env;
  const platform = io.platform ?? process.platform;
  const home = (io.homedir ?? osHomedir)();

  const xdg = env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, 'lanhu', 'config.json');
  if (platform === 'win32') {
    const appData = env.APPDATA || join(home, 'AppData', 'Roaming');
    return join(appData, 'lanhu', 'config.json');
  }
  return join(home, '.config', 'lanhu', 'config.json');
}

// Missing file -> {}; unparseable file -> CONFIG_INVALID (exit 3) so a broken
// credentials file fails loudly instead of silently dropping the token.
export function readUserConfig(path: string): UserConfigData {
  if (!existsSync(path)) return {};
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LanhuError(
      'CONFIG_INVALID',
      `Failed to read user config ${path}: ${message}`,
      { cause: error }
    );
  }
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new Error('expected a JSON object');
    }
    return parsed as UserConfigData;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LanhuError(
      'CONFIG_INVALID',
      `User config ${path} is not valid JSON: ${message}`,
      { cause: error }
    );
  }
}

// Merge-write the user config with 0600 permissions (0700 directory).
export function writeUserConfig(
  path: string,
  patch: UserConfigData
): UserConfigData {
  const current = readUserConfig(path);
  const merged: UserConfigData = { ...current, ...patch };
  // Drop keys explicitly set to undefined.
  for (const key of Object.keys(merged) as Array<keyof UserConfigData>) {
    if (merged[key] === undefined) delete merged[key];
  }

  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, {
      mode: 0o600
    });
    // writeFileSync mode only applies on creation; enforce on rewrite too.
    chmodSync(path, 0o600);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LanhuError(
      'IO_WRITE_FAILED',
      `Failed to write user config ${path}: ${message}`,
      { cause: error }
    );
  }
  return merged;
}
