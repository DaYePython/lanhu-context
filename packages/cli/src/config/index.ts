// Configuration layer (DESIGN.md §7, M2 scope):
//   CLI flag > process env > env file (--env-file/--env-path > ENV_FILE >
//   <cwd>/.env.local) > default.
// --cwd is applied (chdir) before the env file is loaded so relative paths
// and the default .env.local resolve against it.
//
// lanhu.config (c12) and the user-level config file arrive in M3 — this
// module is the single insertion point for those extra layers (add them
// between `fileEnv` and the defaults in resolveConfig()).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  DEFAULT_HTTP_TIMEOUT,
  LanhuError,
  type PromptLang
} from '@lanhu-context/core';
import { parse as parseDotenv } from 'dotenv';

export const DEFAULT_RETRIES = 2;
export const DEFAULT_ENV_FILE = '.env.local';

export type TokenSource = 'flag' | 'env' | 'env-file';

export interface ConfigFlags {
  token?: string;
  ddsToken?: string;
  timeout?: string;
  retries?: string;
  envFile?: string;
  cwd?: string;
  lang?: string;
}

export interface ResolvedConfig {
  token?: string;
  tokenSource?: TokenSource;
  ddsToken?: string;
  timeout: number;
  retries: number;
  lang: PromptLang;
  /** The env file that was actually loaded, if any. */
  envFilePath?: string;
  cwd: string;
}

// Injectable process bindings so unit tests can avoid touching the real
// process state.
export interface ProcessIo {
  env?: Record<string, string | undefined>;
  chdir?: (dir: string) => void;
  getCwd?: () => string;
}

function parseIntegerFlag(
  name: string,
  raw: string | undefined,
  fallback: number,
  { min }: { min: number }
): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new LanhuError(
      'USAGE_ERROR',
      `${name} expects an integer >= ${min}, got "${raw}"`
    );
  }
  return value;
}

function parseLangFlag(
  raw: string | undefined,
  envRaw: string | undefined
): PromptLang {
  if (raw !== undefined) {
    if (raw !== 'zh-CN' && raw !== 'en-US') {
      throw new LanhuError(
        'USAGE_ERROR',
        `--lang expects "zh-CN" or "en-US", got "${raw}"`
      );
    }
    return raw;
  }
  // Env values are coerced leniently (upstream PROMPT_LANG behavior).
  return envRaw === 'zh-CN' ? 'zh-CN' : 'en-US';
}

export function resolveConfig(
  flags: ConfigFlags,
  io: ProcessIo = {}
): ResolvedConfig {
  const env = io.env ?? process.env;
  const chdir = io.chdir ?? process.chdir.bind(process);
  const getCwd = io.getCwd ?? (() => process.cwd());

  // 1. --cwd first: it anchors env-file loading and relative output paths.
  if (flags.cwd) {
    const target = resolvePath(getCwd(), flags.cwd);
    let isDirectory = false;
    try {
      isDirectory = statSync(target).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isDirectory) {
      throw new LanhuError(
        'CONFIG_INVALID',
        `--cwd is not an existing directory: ${target}`
      );
    }
    chdir(target);
  }
  const cwd = getCwd();

  // 2. env file: explicit --env-file/--env-path > ENV_FILE > <cwd>/.env.local.
  // An explicitly requested file must exist; the default one is optional.
  const explicitEnvFile = flags.envFile ?? env.ENV_FILE;
  let envFilePath: string | undefined;
  if (explicitEnvFile) {
    const p = resolvePath(cwd, explicitEnvFile);
    if (!existsSync(p)) {
      throw new LanhuError('CONFIG_INVALID', `env file not found: ${p}`);
    }
    envFilePath = p;
  } else {
    const p = resolvePath(cwd, DEFAULT_ENV_FILE);
    if (existsSync(p)) envFilePath = p;
  }

  let fileEnv: Record<string, string> = {};
  if (envFilePath) {
    fileEnv = parseDotenv(readFileSync(envFilePath, 'utf8'));
  }

  // 3. merge: flag > process env > env file > default.
  let token: string | undefined;
  let tokenSource: TokenSource | undefined;
  if (flags.token) {
    token = flags.token;
    tokenSource = 'flag';
  } else if (env.LANHU_TOKEN) {
    token = env.LANHU_TOKEN;
    tokenSource = 'env';
  } else if (fileEnv.LANHU_TOKEN) {
    token = fileEnv.LANHU_TOKEN;
    tokenSource = 'env-file';
  }

  const ddsToken =
    flags.ddsToken || env.DDS_TOKEN || fileEnv.DDS_TOKEN || undefined;

  return {
    token,
    tokenSource,
    ddsToken,
    timeout: parseIntegerFlag(
      '--timeout',
      flags.timeout,
      DEFAULT_HTTP_TIMEOUT,
      { min: 1 }
    ),
    retries: parseIntegerFlag('--retries', flags.retries, DEFAULT_RETRIES, {
      min: 0
    }),
    lang: parseLangFlag(flags.lang, env.PROMPT_LANG ?? fileEnv.PROMPT_LANG),
    envFilePath,
    cwd
  };
}

// Commands that talk to the Lanhu API call this lazily; parse/html-offline
// never require a token.
export function requireToken(config: ResolvedConfig): string {
  if (config.token) return config.token;
  throw new LanhuError(
    'TOKEN_MISSING',
    'LANHU_TOKEN is not configured (checked --token, env LANHU_TOKEN, and the env file)',
    {
      hint:
        'LANHU_TOKEN 是登录 lanhuapp.com 后浏览器请求头中的整段 Cookie。' +
        '推荐写入 <cwd>/.env.local（LANHU_TOKEN=...），或用 --token / 环境变量传入；' +
        '后续版本将提供 `lanhu auth set` 管理凭据。'
    }
  );
}
