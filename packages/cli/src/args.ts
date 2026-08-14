// Shared citty arg definitions (DESIGN.md §4.2).

import { LanhuError } from '@lanhu-context/core';
import type { ArgsDef, ParsedArgs } from 'citty';
import type { ConfigFlags } from './config/index';

// citty's ParsedArgs<T> is not assignable across arg-def shapes; commands
// hand their parsed args to the shared runner through this loose view.
export type AnyParsedArgs = { _: string[] } & Record<string, unknown>;

export const globalArgs = {
  token: {
    type: 'string',
    description:
      'LANHU_TOKEN（登录 lanhuapp.com 的整段浏览器 Cookie；优先用 env/.env.local，避免进 shell 历史）'
  },
  'dds-token': {
    type: 'string',
    description: 'DDS_TOKEN（dds.lanhuapp.com 凭据），缺省复用 --token'
  },
  timeout: {
    type: 'string',
    valueHint: 'ms',
    description: 'HTTP 超时毫秒数（默认 30000）'
  },
  retries: {
    type: 'string',
    valueHint: 'n',
    description:
      '仅对可重试错误（网络超时/5xx/下载）重试的次数，指数退避（默认 2）'
  },
  'env-file': {
    type: 'string',
    alias: 'env-path',
    valueHint: 'path',
    description: 'env 文件路径（默认 <cwd>/.env.local；--env-path 为兼容别名）'
  },
  cwd: {
    type: 'string',
    valueHint: 'path',
    description: '工作目录锚点（先于 env 加载与相对路径解析生效）'
  },
  json: {
    type: 'boolean',
    default: false,
    description: '输出结构化 envelope JSON（报告类命令在无 TTY 时自动开启）'
  },
  quiet: {
    type: 'boolean',
    alias: 'q',
    default: false,
    description: 'stderr 只保留 error'
  },
  verbose: {
    type: 'boolean',
    default: false,
    description: 'stderr 输出 debug 日志（含各阶段耗时）'
  },
  color: {
    type: 'boolean',
    default: true,
    negativeDescription: '禁用颜色（NO_COLOR 环境变量亦生效）'
  },
  strict: {
    type: 'boolean',
    default: false,
    description: '任何 warning 升级为失败（退出码 8，CI 用）'
  },
  lang: {
    type: 'string',
    alias: 'prompt-lang',
    valueHint: 'zh-CN|en-US',
    description: '指引文本语言（默认 en-US；--prompt-lang 为兼容别名）'
  }
} as const satisfies ArgsDef;

// Transform flags shared by `html` and `context`.
export const transformArgs = {
  tailwind: {
    type: 'boolean',
    alias: 'tailwindcss',
    default: false,
    description:
      '将 CSS 转换为 Tailwind 工具类（旧名 --tailwindcss 已废弃，仍可用）'
  },
  'tw-version': {
    type: 'string',
    valueHint: '3|4',
    description: 'Tailwind 引擎版本（默认 3）'
  },
  'unit-scale': {
    type: 'string',
    valueHint: 'n',
    description: '全局尺寸倍率（如 2x 稿用 0.5）'
  },
  'skip-slices': {
    type: 'boolean',
    default: false,
    description: '跳过切图定位与下载映射'
  },
  'assets-dir': {
    type: 'string',
    valueHint: 'path',
    description: '映射中的本地图片路径前缀（默认 ./src/assets/<设计稿名>）'
  }
} as const satisfies ArgsDef;

export type GlobalArgs = ParsedArgs<typeof globalArgs>;

// --stdin batch mode flags (§5.1) — only on commands with a batchItem handler.
export const batchArgs = {
  stdin: {
    type: 'boolean',
    default: false,
    description:
      '批处理：从 stdin 逐行读 URL（或 NDJSON {"url":...}），stdout 逐条输出 envelope NDJSON；与位置参数/--inline 互斥'
  },
  'keep-going': {
    type: 'boolean',
    default: false,
    description:
      '批处理单条失败不中断（默认首败即停）；部分失败时整体退出码 9，明细看 stdout NDJSON 的 ok:false 行'
  }
} as const satisfies ArgsDef;

export function toOutputOption(args: AnyParsedArgs): string | undefined {
  const value = args.output;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

// Validated --format for `tokens` (json | css).
export function toTokensFormat(args: AnyParsedArgs): 'json' | 'css' {
  const raw = args.format;
  if (raw === undefined || raw === '' || raw === 'json') return 'json';
  if (raw === 'css') return 'css';
  throw new LanhuError(
    'USAGE_ERROR',
    `--format expects "json" or "css", got "${String(raw)}"`
  );
}

// Validated --concurrency for `assets --download` (integer >= 1).
export function toConcurrency(args: AnyParsedArgs, fallback: number): number {
  const raw = args.concurrency;
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new LanhuError(
      'USAGE_ERROR',
      `--concurrency expects an integer >= 1, got "${String(raw)}"`
    );
  }
  return value;
}

export function toConfigFlags(args: AnyParsedArgs): ConfigFlags {
  return {
    token: asOptionalString(args.token),
    ddsToken: asOptionalString(args['dds-token']),
    timeout: asOptionalString(args.timeout),
    retries: asOptionalString(args.retries),
    envFile: asOptionalString(args['env-file']),
    cwd: asOptionalString(args.cwd),
    lang: asOptionalString(args.lang)
  };
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export interface TransformOptions {
  tailwind: boolean;
  twVersion: 3 | 4;
  unitScale?: number;
  skipSlices: boolean;
  assetsDir?: string;
}

// Parse and validate the shared transform flags; invalid values are usage
// errors (exit 2).
export function toTransformOptions(args: AnyParsedArgs): TransformOptions {
  const rawTw = asOptionalString(args['tw-version']);
  let twVersion: 3 | 4 = 3;
  if (rawTw !== undefined) {
    if (rawTw !== '3' && rawTw !== '4') {
      throw new LanhuError(
        'USAGE_ERROR',
        `--tw-version expects 3 or 4, got "${rawTw}"`
      );
    }
    twVersion = rawTw === '4' ? 4 : 3;
  }

  const rawScale = asOptionalString(args['unit-scale']);
  let unitScale: number | undefined;
  if (rawScale !== undefined) {
    const value = Number(rawScale);
    if (!Number.isFinite(value) || value <= 0) {
      throw new LanhuError(
        'USAGE_ERROR',
        `--unit-scale expects a positive number, got "${rawScale}"`
      );
    }
    unitScale = value;
  }

  return {
    tailwind: args.tailwind === true,
    twVersion,
    unitScale,
    skipSlices: args['skip-slices'] === true,
    assetsDir: asOptionalString(args['assets-dir'])
  };
}
