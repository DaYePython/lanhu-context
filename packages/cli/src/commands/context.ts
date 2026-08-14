import { Buffer } from 'node:buffer';
import {
  composeContext,
  LanhuError,
  resolveOutDir,
  writeDesignFiles
} from '@lanhu-context/core';
import { defineCommand } from 'citty';
import {
  batchArgs,
  globalArgs,
  toTransformOptions,
  transformArgs
} from '../args';
import { createClient, requireUrlArg } from '../lib';
import { executeCommand, type RunnerContext } from '../runner';

interface DeliveredFile {
  path: string;
  type: 'context' | 'preview';
  bytes: number;
  status: string;
}

// Files-mode pipeline shared by the single-run handler and --stdin batch
// mode: compose the context, write context.md (+preview.png), report.
async function composeAndDeliver(ctx: RunnerContext, url: string) {
  const { args } = ctx;
  const transform = toTransformOptions(args);
  const client = createClient(ctx);

  const result = await ctx.timed('compose-context', () =>
    composeContext({
      client,
      url,
      options: {
        unitScale: transform.unitScale,
        skipSlices: transform.skipSlices,
        assetsDir: transform.assetsDir,
        tailwind: transform.tailwind,
        twVersion: transform.twVersion,
        lang: ctx.config.lang
      }
    })
  );
  ctx.warnings.push(...result.warnings);
  const assetsTotal = Object.keys(result.assetsMapping).length;

  const outDirFlag = args['out-dir'];
  const outDir = resolveOutDir(
    typeof outDirFlag === 'string' && outDirFlag !== '' ? outDirFlag : undefined
  );
  const delivery = await ctx.timed('write-files', () =>
    writeDesignFiles({
      outDir: outDir.path,
      imageId: result.imageId,
      designName: result.designName,
      contextBody: result.contextBody,
      previewBuffer: result.previewBuffer,
      force: args.force === true
    })
  );

  const files: DeliveredFile[] = [
    {
      path: delivery.files.context.path,
      type: 'context',
      bytes: delivery.files.context.sizeBytes,
      status: delivery.files.context.status
    }
  ];
  if (delivery.files.preview) {
    files.push({
      path: delivery.files.preview.path,
      type: 'preview',
      bytes: delivery.files.preview.sizeBytes,
      status: delivery.files.preview.status
    });
  }

  return {
    designName: result.designName,
    projectName: result.projectName,
    imageId: result.imageId,
    dir: delivery.dir,
    files,
    assets: {
      total: assetsTotal,
      downloaded: 0,
      mappingIncluded: assetsTotal > 0
    }
  };
}

export const contextCommand = defineCommand({
  meta: {
    name: 'context',
    description: [
      '复合命令：一次产出 context.md（HTML + 切图映射 + Design Tokens + 实现指引）与 preview.png，',
      '默认落盘到 --out-dir 并输出文件清单报告；--inline 时 stdout 直出 context 正文（摘要走 stderr）。',
      '',
      '示例:',
      '  lanhu context "$URL" --json',
      '  lanhu context "$URL" --tailwind --tw-version 4 --out-dir .lanhu --force',
      '  lanhu context "$URL" --inline | claude -p "按 context 实现这个页面"',
      '  cat urls.txt | lanhu context --stdin --keep-going --out-dir .lanhu > report.ndjson'
    ].join('\n')
  },
  args: {
    url: {
      type: 'positional',
      required: false,
      valueHint: 'url',
      description: '蓝湖设计稿完整 URL 或 query 串；批量用 --stdin'
    },
    inline: {
      type: 'boolean',
      default: false,
      description:
        'stdout 直接输出 context 正文（产物流；与 --json/--stdin 互斥）'
    },
    'out-dir': {
      type: 'string',
      valueHint: 'path',
      description: '落盘目录（默认 <cwd>/.lanhu.local）'
    },
    force: {
      type: 'boolean',
      default: false,
      description: '跳过内容 hash 比对，强制重写全部产物文件'
    },
    ...globalArgs,
    ...transformArgs,
    ...batchArgs
  },
  run: ({ args, rawArgs }) =>
    executeCommand({
      command: 'context',
      kind: a => (a.inline === true ? 'artifact' : 'report'),
      args,
      rawArgs,
      preValidate: a => {
        // §5 channel boundary: --inline claims stdout for the context body,
        // so an envelope cannot share the stream.
        if (a.inline === true && a.json === true) {
          throw new LanhuError(
            'USAGE_ERROR',
            '`context --inline` 与 `--json` 互斥：--inline 的 stdout 即 context 正文本体（需要 envelope 请去掉 --inline）'
          );
        }
      },
      handler: async ctx => {
        const url = requireUrlArg(args.url);

        if (args.inline === true) {
          const transform = toTransformOptions(args);
          const client = createClient(ctx);
          const result = await ctx.timed('compose-context', () =>
            composeContext({
              client,
              url,
              options: {
                unitScale: transform.unitScale,
                skipSlices: transform.skipSlices,
                assetsDir: transform.assetsDir,
                tailwind: transform.tailwind,
                twVersion: transform.twVersion,
                lang: ctx.config.lang
              }
            })
          );
          ctx.warnings.push(...result.warnings);
          const assetsTotal = Object.keys(result.assetsMapping).length;
          const bytes = Buffer.byteLength(result.contextBody, 'utf8');
          return {
            data: {
              designName: result.designName,
              projectName: result.projectName,
              imageId: result.imageId,
              bytes
            },
            artifact: result.contextBody,
            summary: [
              `design: ${result.designName} (${result.imageId.slice(0, 8)})`,
              `context: ${bytes} bytes inline; assets mapping: ${assetsTotal}`
            ]
          };
        }

        const data = await composeAndDeliver(ctx, url);

        return {
          data,
          render: () => {
            const lines = [
              `design   ${data.designName}${data.projectName ? `（${data.projectName}）` : ''}`,
              `imageId  ${data.imageId}`,
              `dir      ${data.dir}`,
              'files:'
            ];
            for (const file of data.files) {
              lines.push(
                `  ${file.type.padEnd(8)} ${file.status.padEnd(11)} ${file.bytes} B  ${file.path}`
              );
            }
            lines.push(
              `assets   ${data.assets.total} slice mapping entr${data.assets.total === 1 ? 'y' : 'ies'} (download via curl commands in context.md)`
            );
            return lines.join('\n');
          }
        };
      },
      batchItem: async (url, ctx) => ({
        data: await composeAndDeliver(ctx, url)
      })
    })
});
