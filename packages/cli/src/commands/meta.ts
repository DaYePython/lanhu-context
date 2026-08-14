import { fetchMeta, parseLanhuUrl } from '@lanhu-context/core';
import { defineCommand } from 'citty';
import { batchArgs, globalArgs } from '../args';
import { readStdin } from '../io/stdin';
import { createClient, requireUrlArg, toDesignRequest } from '../lib';
import { executeCommand, type RunnerContext } from '../runner';

async function fetchMetaData(ctx: RunnerContext, url: string) {
  const params = parseLanhuUrl(url);
  const client = createClient(ctx);
  const meta = await ctx.timed('fetch-meta', () =>
    fetchMeta(client, toDesignRequest(params))
  );
  return {
    name: meta.name,
    projectName: meta.projectName,
    imageId: meta.id,
    previewUrl: meta.url,
    versions: meta.versions
  };
}

export const metaCommand = defineCommand({
  meta: {
    name: 'meta',
    description: [
      '设计稿元数据（报告类）：{name, projectName, imageId, previewUrl, versions 摘要}',
      '',
      '示例:',
      '  lanhu meta "$URL"',
      '  lanhu meta "$URL" --json | jq -r .data.previewUrl',
      '  cat urls.txt | lanhu meta --stdin --keep-going > report.ndjson'
    ].join('\n')
  },
  args: {
    url: {
      type: 'positional',
      required: false,
      valueHint: 'url|-',
      description:
        '蓝湖设计稿完整 URL 或 query 串，- 从 stdin 读取单条；批量用 --stdin'
    },
    ...globalArgs,
    ...batchArgs
  },
  run: ({ args, rawArgs }) =>
    executeCommand({
      command: 'meta',
      kind: 'report',
      args,
      rawArgs,
      handler: async ctx => {
        let input = requireUrlArg(args.url, { allowStdin: true });
        if (input === '-') {
          input = (await readStdin()).trim();
        }
        const data = await fetchMetaData(ctx, input);
        return {
          data,
          render: () =>
            [
              `name         ${data.name}`,
              `projectName  ${data.projectName ?? '-'}`,
              `imageId      ${data.imageId}`,
              `previewUrl   ${data.previewUrl ?? '-'}`,
              `versions     count=${data.versions?.count ?? 0} latestHasSketchJson=${data.versions?.latestHasSketchJson ?? false}`
            ].join('\n')
        };
      },
      batchItem: async (url, ctx) => ({ data: await fetchMetaData(ctx, url) })
    })
});
