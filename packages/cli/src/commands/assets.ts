import {
  type AssetDownloadItem,
  DEFAULT_DOWNLOAD_CONCURRENCY,
  downloadAssets,
  fetchMeta,
  fetchSchema,
  makeWarning,
  parseLanhuUrl,
  renderHtml
} from '@lanhu-context/core';
import { defineCommand } from 'citty';
import { globalArgs, toConcurrency, toOutputOption } from '../args';
import { createClient, requireUrlArg, toDesignRequest } from '../lib';
import { executeCommand } from '../runner';

export const assetsCommand = defineCommand({
  meta: {
    name: 'assets',
    description: [
      '切图映射（报告类）：默认输出 本地路径 → 远程 URL 的映射 JSON；--download 时并发下载落盘。',
      '下载幂等：按内容 hash 比对，一致跳过（skipped）、不一致覆盖（overwritten）、新文件写入（written）；',
      '单张失败记 warning 继续（--strict 首败即停并整体退出码 8）。',
      '',
      '示例:',
      '  lanhu assets "$URL"',
      '  lanhu assets "$URL" --download -o src/assets/lanhu --concurrency 4',
      '  lanhu assets "$URL" --download --dry-run --json | jq .data.items',
      '  lanhu assets "$URL" --assets-dir ./assets/lanhu --json | jq .data.mapping'
    ].join('\n')
  },
  args: {
    url: {
      type: 'positional',
      required: false,
      valueHint: 'url',
      description: '蓝湖设计稿完整 URL 或 query 串'
    },
    download: {
      type: 'boolean',
      default: false,
      description: '实际并发下载切图（默认只输出映射）'
    },
    concurrency: {
      type: 'string',
      valueHint: 'n',
      description: '并发下载数（默认 4）'
    },
    output: {
      type: 'string',
      alias: 'o',
      valueHint: 'dir',
      description:
        '下载落盘目录（同时作为映射的本地路径前缀；优先于 --assets-dir）'
    },
    'assets-dir': {
      type: 'string',
      valueHint: 'path',
      description: '映射中的本地图片路径前缀（默认 ./src/assets/<设计稿名>）'
    },
    'dry-run': {
      type: 'boolean',
      default: false,
      description: '配合 --download：只报告将下载哪些文件，不写盘'
    },
    force: {
      type: 'boolean',
      default: false,
      description: '跳过内容 hash 比对，强制重写全部切图'
    },
    ...globalArgs
  },
  run: ({ args, rawArgs }) =>
    executeCommand({
      command: 'assets',
      kind: 'report',
      args,
      rawArgs,
      handler: async ctx => {
        const url = requireUrlArg(args.url);
        const concurrency = toConcurrency(args, DEFAULT_DOWNLOAD_CONCURRENCY);
        const outputDir = toOutputOption(args);
        const assetsDirFlag =
          typeof args['assets-dir'] === 'string' && args['assets-dir'] !== ''
            ? (args['assets-dir'] as string)
            : undefined;
        const assetsDir = outputDir ?? assetsDirFlag;
        const download = args.download === true;
        const dryRun = args['dry-run'] === true;

        const params = parseLanhuUrl(url);
        const request = toDesignRequest(params);
        const client = createClient(ctx);
        const meta = await ctx.timed('fetch-meta', () =>
          fetchMeta(client, request)
        );
        const schema = await ctx.timed('fetch-schema', () =>
          fetchSchema(client, request)
        );
        const rendered = await ctx.timed('render-html', () =>
          renderHtml(schema, { designName: meta.name, assetsDir })
        );
        const mapping = rendered.assetsMapping;
        const total = Object.keys(mapping).length;

        const base = {
          designName: meta.name,
          imageId: meta.id,
          total,
          assetsDir: assetsDir ?? null
        };

        // Mapping-only report (no --download).
        if (!download && !dryRun) {
          return {
            data: { ...base, mapping },
            render: () => {
              const lines = [
                `design  ${meta.name} (${meta.id.slice(0, 8)})`,
                `assets  ${total} slice(s)`
              ];
              for (const [localPath, remoteUrl] of Object.entries(mapping)) {
                lines.push(`  ${localPath} <- ${remoteUrl}`);
              }
              return lines.join('\n');
            }
          };
        }

        // --dry-run: report the planned downloads without writing anything.
        if (dryRun) {
          const items = Object.entries(mapping).map(
            ([localPath, remoteUrl]) => ({
              localPath,
              remoteUrl,
              status: 'planned' as const
            })
          );
          return {
            data: { ...base, dryRun: true, items },
            render: () =>
              [
                `dry-run: would download ${total} slice(s)`,
                ...items.map(i => `  ${i.localPath} <- ${i.remoteUrl}`)
              ].join('\n')
          };
        }

        const result = await ctx.timed('download-assets', () =>
          downloadAssets({
            mapping,
            baseDir: ctx.config.cwd,
            concurrency,
            force: args.force === true,
            stopOnError: args.strict === true,
            download: remoteUrl => client.downloadImage({ imgUrl: remoteUrl }),
            onItem: item =>
              ctx.logger.debug(`${item.status.padEnd(11)} ${item.localPath}`)
          })
        );

        for (const item of result.items) {
          if (item.status === 'failed') {
            ctx.warnings.push(
              makeWarning(
                'ASSET_DOWNLOAD_FAILED',
                `${item.localPath} <- ${item.remoteUrl}: ${item.error?.message ?? 'download failed'}`
              )
            );
          }
        }

        const data = {
          ...base,
          summary: result.summary,
          items: result.items.map((item: AssetDownloadItem) => ({
            localPath: item.localPath,
            path: item.absolutePath,
            remoteUrl: item.remoteUrl,
            status: item.status,
            bytes: item.bytes,
            error: item.error
          }))
        };

        return {
          data,
          render: () => {
            const lines = [
              `design    ${meta.name} (${meta.id.slice(0, 8)})`,
              `download  total=${result.summary.total} written=${result.summary.written} skipped=${result.summary.skipped} overwritten=${result.summary.overwritten} failed=${result.summary.failed}`
            ];
            for (const item of result.items) {
              lines.push(
                `  ${item.status.padEnd(11)} ${item.localPath}${item.error ? `  (${item.error.code})` : ''}`
              );
            }
            return lines.join('\n');
          }
        };
      }
    })
});
