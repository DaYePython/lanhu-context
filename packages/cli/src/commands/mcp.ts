import { LanhuError, toLanhuError } from '@lanhu-context/core';
import { type McpMode, startServer } from '@lanhu-context/mcp';
import { defineCommand } from 'citty';
import {
  type AnyParsedArgs,
  globalArgs,
  toConfigFlags,
  toTransformOptions,
  transformArgs
} from '../args';
import { requireToken, resolveConfig } from '../config/index';
import { exitCodeForError, finishWith } from '../exit';
import { createLogger } from '../io/logger';

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function toMcpMode(args: AnyParsedArgs): McpMode | undefined {
  const raw = asOptionalString(args.mode);
  if (raw === undefined) return undefined;
  if (raw === 'inline' || raw === 'files') return raw;
  throw new LanhuError(
    'USAGE_ERROR',
    `--mode expects "inline" or "files", got "${raw}"`
  );
}

function toPort(args: AnyParsedArgs): number | undefined {
  const raw = asOptionalString(args.port);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new LanhuError(
      'USAGE_ERROR',
      `--port expects an integer between 1 and 65535, got "${raw}"`
    );
  }
  return value;
}

async function runMcp(args: AnyParsedArgs): Promise<void> {
  // stdio transport: stdout carries JSON-RPC frames only. createLogger
  // already routes every diagnostic line to stderr.
  const logger = createLogger({
    quiet: args.quiet === true,
    verbose: args.verbose === true
  });

  try {
    if (args.stdio === true && args.http === true) {
      throw new LanhuError(
        'USAGE_ERROR',
        '--stdio 与 --http 互斥：一次只能挂载一种 transport'
      );
    }
    const mode = toMcpMode(args);
    const port = toPort(args);
    const transform = toTransformOptions(args);
    const config = resolveConfig(toConfigFlags(args));
    const token = requireToken(config);

    const running = await startServer({
      lanhuToken: token,
      ddsToken: config.ddsToken,
      timeout: config.timeout,
      retries: config.retries,
      lang: config.lang,
      mode,
      outDir: asOptionalString(args['out-dir']),
      tailwind: transform.tailwind,
      twVersion: transform.twVersion,
      skipSlices: transform.skipSlices,
      unitScale: transform.unitScale,
      assetsDir: transform.assetsDir,
      compatStrict: args['compat-strict'] === true,
      transport: args.http === true ? 'http' : 'stdio',
      host: asOptionalString(args.host),
      port,
      log: message => logger.info(message)
    });

    if (running.transport === 'http') {
      logger.info(`get_design_context 已注册；POST ${running.url}`);
    } else {
      logger.debug('MCP stdio server connected; waiting for JSON-RPC frames');
    }
    // The process stays alive on the transport (stdin / HTTP listener); it
    // exits when the client closes stdio or the listener is terminated.
  } catch (error) {
    const err = toLanhuError(error);
    const hintSuffix = err.hint ? `\nhint: ${err.hint}` : '';
    logger.error(`${err.code}: ${err.message}${hintSuffix}`);
    finishWith(exitCodeForError(err));
  }
}

export const mcpCommand = defineCommand({
  meta: {
    name: 'mcp',
    description: [
      '启动 MCP 兼容 server（工具 get_design_context，对外契约与上游 lanhu-context-mcp 一致）。',
      '默认 stdio transport（stdout 只承载 JSON-RPC 帧）；--http 切换为 streamable HTTP（POST /mcp）。',
      '与上游的默认行为差异：tokens/preview 等附属内容缺失时仍返回主体结果，缺失项列在返回文本末尾的 warnings 段；',
      '--compat-strict 恢复上游"附属内容失败则整体报错"的行为。',
      '',
      '示例:',
      '  lanhu mcp --stdio',
      '  lanhu mcp --stdio --mode files --out-dir .lanhu.local',
      '  lanhu mcp --http --host 127.0.0.1 --port 5200',
      '  lanhu mcp --stdio --tailwind --tw-version 4 --lang zh-CN --compat-strict'
    ].join('\n')
  },
  args: {
    stdio: {
      type: 'boolean',
      default: false,
      description: '使用 stdio transport（默认）'
    },
    http: {
      type: 'boolean',
      default: false,
      description: '使用 streamable HTTP transport（POST /mcp）'
    },
    host: {
      type: 'string',
      valueHint: 'host',
      description: 'HTTP host（默认 127.0.0.1，仅 --http 生效）'
    },
    port: {
      type: 'string',
      valueHint: 'port',
      description: 'HTTP 端口（默认 5200，仅 --http 生效）'
    },
    mode: {
      type: 'string',
      valueHint: 'inline|files',
      description:
        '工具默认输出模式：inline（content 直出正文）| files（落盘后返回 resource_link），默认 inline'
    },
    'out-dir': {
      type: 'string',
      valueHint: 'path',
      description: 'files 模式落盘目录（默认 <cwd>/.lanhu.local）'
    },
    'compat-strict': {
      type: 'boolean',
      default: false,
      description:
        '恢复上游行为：tokens/preview 等附属内容失败时整体返回 isError（默认是继续返回主体结果并在 warnings 段列出缺失项）'
    },
    ...globalArgs,
    ...transformArgs
  },
  run: async ({ args }) => {
    await runMcp(args as unknown as AnyParsedArgs);
  }
});
