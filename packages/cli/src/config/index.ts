// Configuration layer (DESIGN.md §7, M3):
//   CLI flag > process env > env file (--env-file/--env-path > ENV_FILE >
//   <cwd>/.env.local) > lanhu.config.json (project) > user config.json >
//   default.
// --cwd is applied (chdir) before the env file is loaded so relative paths
// and the default .env.local resolve against it.
//
// TODO(c12): the project layer currently reads <cwd>/lanhu.config.json
// directly; swapping in c12 would additionally support lanhu.config.ts/rc
// variants without changing the precedence chain.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  DEFAULT_HTTP_TIMEOUT,
  LanhuError,
  type PromptLang
} from '@lanhu-context/core';
import { parse as parseDotenv } from 'dotenv';
import {
  readUserConfig,
  resolveUserConfigPath,
  type UserConfigData
} from './user-config';

export const DEFAULT_RETRIES = 2;
export const DEFAULT_ENV_FILE = '.env.local';
export const PROJECT_CONFIG_FILE = 'lanhu.config.json';

export type TokenSource =
  | 'flag'
  | 'env'
  | 'env-file'
  | 'project-config'
  | 'user-config';

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
  ddsTokenSource?: TokenSource;
  timeout: number;
  retries: number;
  lang: PromptLang;
  /** The env file that was actually loaded, if any. */
  envFilePath?: string;
  /** The project-level lanhu.config.json that was loaded, if any. */
  projectConfigPath?: string;
  /** Resolved user-level config path (the file may not exist). */
  userConfigPath: string;
  /** Whether the user-level config file exists. */
  userConfigExists: boolean;
  cwd: string;
  /** LANHU_TEST_URL from env/env-file — `auth test` fallback URL. */
  testUrl?: string;
}

// Injectable process bindings so unit tests can avoid touching the real
// process state (including the real user config directory).
export interface ProcessIo {
  env?: Record<string, string | undefined>;
  chdir?: (dir: string) => void;
  getCwd?: () => string;
  platform?: NodeJS.Platform;
  homedir?: () => string;
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

function configInteger(
  name: string,
  raw: unknown,
  { min }: { min: number }
): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min) {
    throw new LanhuError(
      'CONFIG_INVALID',
      `config field "${name}" expects an integer >= ${min}, got ${JSON.stringify(raw)}`
    );
  }
  return raw;
}

function parseLangFlag(
  raw: string | undefined,
  ...lenientCandidates: Array<string | undefined>
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
  // Env/config values are coerced leniently (upstream PROMPT_LANG behavior).
  const candidate = lenientCandidates.find(v => v !== undefined);
  return candidate === 'zh-CN' ? 'zh-CN' : 'en-US';
}

function readProjectConfig(path: string): UserConfigData {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LanhuError(
      'CONFIG_INVALID',
      `Failed to read project config ${path}: ${message}`,
      { cause: error }
    );
  }
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
      `Project config ${path} is not valid JSON: ${message}`,
      { cause: error }
    );
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
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

  // 3. project-level lanhu.config.json (see TODO(c12) above).
  const projectConfigCandidate = resolvePath(cwd, PROJECT_CONFIG_FILE);
  let projectConfigPath: string | undefined;
  let projectConfig: UserConfigData = {};
  if (existsSync(projectConfigCandidate)) {
    projectConfigPath = projectConfigCandidate;
    projectConfig = readProjectConfig(projectConfigCandidate);
  }

  // 4. user-level config.json (XDG paths, written by `lanhu auth set`).
  const userConfigPath = resolveUserConfigPath({
    env,
    platform: io.platform,
    homedir: io.homedir
  });
  const userConfigExists = existsSync(userConfigPath);
  const userConfig: UserConfigData = userConfigExists
    ? readUserConfig(userConfigPath)
    : {};

  // 5. merge: flag > process env > env file > project config > user config
  // > default.
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
  } else if (optionalString(projectConfig.lanhuToken)) {
    token = projectConfig.lanhuToken;
    tokenSource = 'project-config';
  } else if (optionalString(userConfig.lanhuToken)) {
    token = userConfig.lanhuToken;
    tokenSource = 'user-config';
  }

  let ddsToken: string | undefined;
  let ddsTokenSource: TokenSource | undefined;
  if (flags.ddsToken) {
    ddsToken = flags.ddsToken;
    ddsTokenSource = 'flag';
  } else if (env.DDS_TOKEN) {
    ddsToken = env.DDS_TOKEN;
    ddsTokenSource = 'env';
  } else if (fileEnv.DDS_TOKEN) {
    ddsToken = fileEnv.DDS_TOKEN;
    ddsTokenSource = 'env-file';
  } else if (optionalString(projectConfig.ddsToken)) {
    ddsToken = projectConfig.ddsToken;
    ddsTokenSource = 'project-config';
  } else if (optionalString(userConfig.ddsToken)) {
    ddsToken = userConfig.ddsToken;
    ddsTokenSource = 'user-config';
  }

  const timeoutDefault =
    configInteger('timeout', projectConfig.timeout, { min: 1 }) ??
    configInteger('timeout', userConfig.timeout, { min: 1 }) ??
    DEFAULT_HTTP_TIMEOUT;
  const retriesDefault =
    configInteger('retries', projectConfig.retries, { min: 0 }) ??
    configInteger('retries', userConfig.retries, { min: 0 }) ??
    DEFAULT_RETRIES;

  return {
    token,
    tokenSource,
    ddsToken,
    ddsTokenSource,
    timeout: parseIntegerFlag('--timeout', flags.timeout, timeoutDefault, {
      min: 1
    }),
    retries: parseIntegerFlag('--retries', flags.retries, retriesDefault, {
      min: 0
    }),
    lang: parseLangFlag(
      flags.lang,
      env.PROMPT_LANG ?? fileEnv.PROMPT_LANG,
      optionalString(projectConfig.lang),
      optionalString(userConfig.lang)
    ),
    envFilePath,
    projectConfigPath,
    userConfigPath,
    userConfigExists,
    cwd,
    testUrl: env.LANHU_TEST_URL ?? fileEnv.LANHU_TEST_URL
  };
}

// Commands that talk to the Lanhu API call this lazily; parse/html-offline
// never require a token.
export function requireToken(config: ResolvedConfig): string {
  if (config.token) return config.token;
  throw new LanhuError(
    'TOKEN_MISSING',
    'LANHU_TOKEN is not configured (checked --token, env LANHU_TOKEN, the env file, lanhu.config.json, and the user config)',
    {
      hint:
        'LANHU_TOKEN 是登录 lanhuapp.com 后浏览器请求头中的整段 Cookie。' +
        '推荐运行 `lanhu auth set` 写入用户级配置（0600），' +
        '或写入 <cwd>/.env.local（LANHU_TOKEN=...），或用 --token / 环境变量传入。'
    }
  );
}

/**
 * Mask a secret for display (DESIGN.md §5.2: tokens never appear in any
 * output). Long secrets show the first/last 4 chars plus length; short ones
 * show only the length.
 */
export function maskSecret(secret: string): string {
  if (secret.length < 12) return `**** (length ${secret.length})`;
  return `${secret.slice(0, 4)}…${secret.slice(-4)} (length ${secret.length})`;
}
