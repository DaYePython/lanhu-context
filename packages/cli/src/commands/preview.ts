import { Buffer } from 'node:buffer';
import { resolve as resolvePath } from 'node:path';
import {
  fetchMeta,
  fetchPreview,
  LanhuError,
  makeWarning,
  parseLanhuUrl,
  writeFileIdempotent
} from '@lanhu-context/core';
import { defineCommand } from 'citty';
import { globalArgs, toOutputOption } from '../args';
import { createClient, requireUrlArg, toDesignRequest } from '../lib';
import { executeCommand } from '../runner';

export const previewCommand = defineCommand({
  meta: {
    name: 'preview',
    description: [
      '预览图：-o <file> 幂等落盘（内容 hash 比对）并在 stdout 输出报告；-o - 直出 PNG 二进制到 stdout',
      '（此时无 envelope，状态看退出码 + stderr）。--json 必须配 -o <file>。',
      '预览图不存在/下载失败为 degraded：退出码 0 + stderr 警告（--strict 时退出码 8）。',
      '',
      '示例:',
      '  lanhu preview "$URL" -o preview.png',
      '  lanhu preview "$URL" -o preview.png --json | jq .data.status',
      '  lanhu preview "$URL" -o - > preview.png'
    ].join('\n')
  },
  args: {
    url: {
      type: 'positional',
      required: false,
      valueHint: 'url',
      description: '蓝湖设计稿完整 URL 或 query 串'
    },
    output: {
      type: 'string',
      alias: 'o',
      valueHint: 'file|-',
      description: 'PNG 输出：文件路径（幂等落盘），或 - 直出二进制到 stdout'
    },
    force: {
      type: 'boolean',
      default: false,
      description: '跳过内容 hash 比对，强制重写输出文件'
    },
    ...globalArgs
  },
  run: ({ args, rawArgs }) =>
    executeCommand({
      command: 'preview',
      // -o -: stdout is the PNG byte stream; -o <file>: stdout is a report.
      kind: a => (toOutputOption(a) === '-' ? 'artifact' : 'report'),
      args,
      rawArgs,
      preValidate: a => {
        const output = toOutputOption(a);
        // §5 boundary: binary artifacts and envelopes never share a stream.
        if (a.json === true && output === '-') {
          throw new LanhuError(
            'USAGE_ERROR',
            '`preview --json` 必须配 `-o <file>`：`-o -` 的 stdout 是 PNG 二进制本体，不能混入 envelope'
          );
        }
        if (a.json === true && output === undefined) {
          throw new LanhuError(
            'USAGE_ERROR',
            '`preview --json` 必须配 `-o <file>`（envelope 报告落盘结果；二进制直出请用 `-o -` 且不带 --json）'
          );
        }
        if (output === undefined) {
          throw new LanhuError(
            'USAGE_ERROR',
            'missing required flag -o/--output：`-o <file>` 落盘，或 `-o -` 直出 PNG 二进制到 stdout'
          );
        }
      },
      handler: async ctx => {
        const output = toOutputOption(args) as string;
        const url = requireUrlArg(args.url);
        const params = parseLanhuUrl(url);
        const client = createClient(ctx);
        const meta = await ctx.timed('fetch-meta', () =>
          fetchMeta(client, toDesignRequest(params))
        );

        let buffer: Buffer | undefined;
        if (!meta.url) {
          ctx.warnings.push(
            makeWarning(
              'PREVIEW_UNAVAILABLE',
              `Design "${meta.name}" has no preview image URL`
            )
          );
        } else {
          try {
            buffer = await ctx.timed('fetch-preview', () =>
              fetchPreview(client, meta.url as string)
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            ctx.warnings.push(
              makeWarning(
                'PREVIEW_UNAVAILABLE',
                `Preview image download failed: ${message}`
              )
            );
          }
        }

        // -o -: raw PNG bytes on stdout (empty when degraded).
        if (output === '-') {
          return {
            data: {
              designName: meta.name,
              imageId: meta.id,
              bytes: buffer?.byteLength ?? 0,
              written: buffer !== undefined
            },
            binary: buffer ?? Buffer.alloc(0),
            summary: buffer
              ? [`preview: ${buffer.byteLength} bytes -> stdout`]
              : []
          };
        }

        // -o <file>: idempotent write + report on stdout.
        const filePath = resolvePath(ctx.config.cwd, output);
        let status: string | undefined;
        if (buffer) {
          status = await ctx.timed('write-preview', () =>
            writeFileIdempotent(filePath, buffer as Buffer, args.force === true)
          );
        }
        const data = {
          designName: meta.name,
          imageId: meta.id,
          path: buffer ? filePath : undefined,
          bytes: buffer?.byteLength ?? 0,
          status: status ?? 'unavailable',
          written: buffer !== undefined
        };
        return {
          data,
          render: () =>
            [
              `design   ${data.designName} (${data.imageId.slice(0, 8)})`,
              `preview  ${data.status.padEnd(11)} ${data.bytes} B  ${data.path ?? '-'}`
            ].join('\n')
        };
      }
    })
});
