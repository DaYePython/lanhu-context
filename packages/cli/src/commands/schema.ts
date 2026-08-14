import { fetchSchema, parseLanhuUrl } from '@lanhu-context/core';
import { defineCommand } from 'citty';
import { globalArgs } from '../args';
import { createClient, requireUrlArg, toDesignRequest } from '../lib';
import { executeCommand } from '../runner';

export const schemaCommand = defineCommand({
  meta: {
    name: 'schema',
    description: [
      '下载设计稿的原始 DDS schema JSON 并输出到 stdout（可存成文件复查，或喂给 `lanhu html -` 离线转换）',
      '',
      '示例:',
      '  lanhu schema "$URL" > page.schema.json',
      '  lanhu schema "$URL" | lanhu html - --tailwind > page.html',
      '  lanhu schema "$URL" --json | jq .data.schema.type'
    ].join('\n')
  },
  args: {
    url: {
      type: 'positional',
      required: false,
      valueHint: 'url',
      description: '蓝湖设计稿完整 URL 或 query 串'
    },
    ...globalArgs
  },
  run: ({ args, rawArgs }) =>
    executeCommand({
      command: 'schema',
      kind: 'artifact',
      args,
      rawArgs,
      handler: async ctx => {
        const url = requireUrlArg(args.url);
        const params = parseLanhuUrl(url);
        const client = createClient(ctx);
        const schema = await ctx.timed('fetch-schema', () =>
          fetchSchema(client, toDesignRequest(params))
        );
        return {
          data: { schema },
          artifact: JSON.stringify(schema)
        };
      }
    })
});
