import { Buffer } from 'node:buffer';
import {
  composeContext,
  LanhuError,
  resolveOutDir,
  writeDesignFiles
} from '@lanhu-context/core';
import { defineCommand } from 'citty';
import { globalArgs, toTransformOptions, transformArgs } from '../args';
import { createClient, requireUrlArg } from '../lib';
import { executeCommand, type RunnerContext } from '../runner';

interface DeliveredFile {
  path: string;
  type: 'context' | 'preview';
  bytes: number;
  status: string;
}

// Files-mode pipeline: compose the context, write context.md (+preview.png),
// report the delivered files.
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
      '一条命令产出完整实现上下文：context.md（HTML + 切图映射 + Design Tokens + 实现指引）与 preview.png，',
      '默认写入 --out-dir 并输出文件清单；--inline 改为把 context 正文直接输出到 stdout（摘要走 stderr）。',
      '',
      '示例:',
      '  lanhu context "$URL" --json',
      '  lanhu context "$URL" --tailwind --tw-version 4 --out-dir .lanhu --force',
      '  lanhu context "$URL" --inline | claude -p "按 context 实现这个页面"'
    ].join('\n')
  },
  args: {
    url: {
      type: 'positional',
      required: false,
      valueHint: 'url',
      description: '蓝湖设计稿完整 URL 或 query 串'
    },
    inline: {
      type: 'boolean',
      default: false,
      description:
        '不写文件，把 context 正文直接输出到 stdout（与 --json 互斥）'
    },
    'out-dir': {
      type: 'string',
      valueHint: 'path',
      description:
        '中间产物目录：存 context.md 与 preview.png（默认 <cwd>/.lanhu.local）。要交付的切图不放这里，用 lanhu assets --download -o 下载到项目目录'
    },
    force: {
      type: 'boolean',
      default: false,
      description:
        '不比对已有文件内容，强制重写全部输出文件（默认内容相同的文件自动跳过）'
    },
    ...globalArgs,
    ...transformArgs
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
      }
    })
});
