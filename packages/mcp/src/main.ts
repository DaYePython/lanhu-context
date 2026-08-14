// Bin entry for `lanhu-context-mcp` — start the MCP server directly from
// @lanhu-context/mcp, no CLI package involved.
//
// stdio (default): stdout carries JSON-RPC frames only; every diagnostic
// line below goes to stderr. Credentials come from env (LANHU_TOKEN /
// DDS_TOKEN), falling back to `--env-file <path>` or `<cwd>/.env.local`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exit } from 'node:process';
import type { McpMode } from './get-design-context';
import { DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, startServer } from './start';
import { MCP_PKG_NAME, MCP_PKG_VERSION } from './version';

const EXIT_USAGE = 2;
const EXIT_AUTH = 4;

const HELP = `${MCP_PKG_NAME} v${MCP_PKG_VERSION}
启动 MCP server（工具 get_design_context，对外契约与上游 lanhu-context-mcp 一致）。

用法:
  lanhu-context-mcp [flags]

transport:
  --stdio                 stdio transport（默认；stdout 只承载 JSON-RPC 帧）
  --http                  streamable HTTP transport（POST /mcp）
  --host <host>           HTTP host（默认 ${DEFAULT_HTTP_HOST}，仅 --http 生效）
  --port <port>           HTTP 端口（默认 ${DEFAULT_HTTP_PORT}，仅 --http 生效）

工具行为:
  --mode <inline|files>   默认输出模式：inline 直出正文 | files 落盘后返回 resource_link（默认 inline）
  --out-dir <path>        files 模式落盘目录（默认 <cwd>/.lanhu.local）
  --compat-strict         恢复上游行为：tokens/preview 等附属内容失败时整体返回 isError
  --lang <en-US|zh-CN>    返回文本语言（默认 en-US）
  --tailwind              HTML 输出转 Tailwind
  --tw-version <3|4>      Tailwind 版本（默认 3，需配合 --tailwind）
  --skip-slices           跳过切图定位与映射
  --unit-scale <n>        尺寸单位倍率
  --assets-dir <path>     切图映射里的本地路径前缀

凭据与环境:
  --env-file <path>       从指定 env 文件读取 LANHU_TOKEN / DDS_TOKEN
  --timeout <ms>          蓝湖 API 超时
  其余凭据解析顺序：env LANHU_TOKEN / DDS_TOKEN > --env-file > <cwd>/.env.local

示例:
  LANHU_TOKEN="<cookie>" lanhu-context-mcp --stdio
  lanhu-context-mcp --http --host 127.0.0.1 --port 5200
  lanhu-context-mcp --stdio --mode files --out-dir .lanhu.local --compat-strict
`;

interface ParsedArgs {
  flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set([
  '--host',
  '--port',
  '--mode',
  '--out-dir',
  '--lang',
  '--tw-version',
  '--unit-scale',
  '--assets-dir',
  '--env-file',
  '--timeout'
]);
const BOOL_FLAGS = new Set([
  '--stdio',
  '--http',
  '--compat-strict',
  '--tailwind',
  '--skip-slices',
  '--help',
  '-h',
  '--version',
  '-v'
]);

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  exit(code);
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (BOOL_FLAGS.has(arg)) {
      flags.set(arg, true);
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        fail(`USAGE_ERROR: ${arg} 需要一个值`, EXIT_USAGE);
      }
      flags.set(arg, value);
      i++;
      continue;
    }
    fail(`USAGE_ERROR: 未知参数 "${arg}"（--help 查看全部 flags）`, EXIT_USAGE);
  }
  return { flags };
}

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
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

function toInt(
  flags: Map<string, string | true>,
  name: string,
  min: number,
  max: number
): number | undefined {
  const raw = flags.get(name);
  if (raw === undefined || raw === true) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(
      `USAGE_ERROR: ${name} 期望 ${min}~${max} 的整数，收到 "${raw}"`,
      EXIT_USAGE
    );
  }
  return value;
}

function toStr(
  flags: Map<string, string | true>,
  name: string
): string | undefined {
  const raw = flags.get(name);
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));

  if (flags.has('--help') || flags.has('-h')) {
    process.stdout.write(HELP);
    return;
  }
  if (flags.has('--version') || flags.has('-v')) {
    process.stdout.write(`${MCP_PKG_VERSION}\n`);
    return;
  }
  if (flags.has('--stdio') && flags.has('--http')) {
    fail(
      'USAGE_ERROR: --stdio 与 --http 互斥：一次只能挂载一种 transport',
      EXIT_USAGE
    );
  }

  const mode = toStr(flags, '--mode');
  if (mode !== undefined && mode !== 'inline' && mode !== 'files') {
    fail(
      `USAGE_ERROR: --mode 期望 "inline" 或 "files"，收到 "${mode}"`,
      EXIT_USAGE
    );
  }
  const lang = toStr(flags, '--lang');
  if (lang !== undefined && lang !== 'en-US' && lang !== 'zh-CN') {
    fail(
      `USAGE_ERROR: --lang 期望 "en-US" 或 "zh-CN"，收到 "${lang}"`,
      EXIT_USAGE
    );
  }
  const twVersion = toStr(flags, '--tw-version');
  if (twVersion !== undefined && twVersion !== '3' && twVersion !== '4') {
    fail(
      `USAGE_ERROR: --tw-version 期望 "3" 或 "4"，收到 "${twVersion}"`,
      EXIT_USAGE
    );
  }

  // Credentials: env > --env-file > <cwd>/.env.local. Tokens never touch argv.
  const envFilePath = toStr(flags, '--env-file');
  const fileEnv = parseEnvFile(
    envFilePath !== undefined
      ? resolve(envFilePath)
      : resolve(process.cwd(), '.env.local')
  );
  const lanhuToken = process.env.LANHU_TOKEN || fileEnv.LANHU_TOKEN || '';
  const ddsToken = process.env.DDS_TOKEN || fileEnv.DDS_TOKEN || undefined;
  if (lanhuToken === '') {
    fail(
      [
        'TOKEN_MISSING: 未找到 LANHU_TOKEN（已登录 lanhuapp.com 会话的整段浏览器 Cookie）。',
        'hint: 通过环境变量 LANHU_TOKEN、--env-file <path> 或 <cwd>/.env.local 提供。'
      ].join('\n'),
      EXIT_AUTH
    );
  }

  const unitScaleRaw = toStr(flags, '--unit-scale');
  const unitScale =
    unitScaleRaw === undefined ? undefined : Number(unitScaleRaw);
  if (
    unitScale !== undefined &&
    !(Number.isFinite(unitScale) && unitScale > 0)
  ) {
    fail(
      `USAGE_ERROR: --unit-scale 期望正数，收到 "${unitScaleRaw}"`,
      EXIT_USAGE
    );
  }

  const running = await startServer({
    lanhuToken,
    ddsToken,
    timeout: toInt(flags, '--timeout', 1, 3_600_000),
    lang: lang as 'en-US' | 'zh-CN' | undefined,
    mode: mode as McpMode | undefined,
    outDir: toStr(flags, '--out-dir'),
    tailwind: flags.get('--tailwind') === true,
    twVersion:
      twVersion === undefined ? undefined : (Number(twVersion) as 3 | 4),
    skipSlices: flags.get('--skip-slices') === true,
    unitScale,
    assetsDir: toStr(flags, '--assets-dir'),
    compatStrict: flags.get('--compat-strict') === true,
    transport: flags.get('--http') === true ? 'http' : 'stdio',
    host: toStr(flags, '--host'),
    port: toInt(flags, '--port', 1, 65_535)
  });

  if (running.transport === 'http') {
    process.stderr.write(`get_design_context 已注册；POST ${running.url}\n`);
  }
  // Process stays alive on the transport (stdin / HTTP listener).
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  exit(1);
});
