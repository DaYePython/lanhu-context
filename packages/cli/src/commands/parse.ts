import { LanhuError, parseLanhuUrl } from '@lanhu-context/core';
import { defineCommand } from 'citty';
import { batchArgs, globalArgs } from '../args';
import { readStdin } from '../io/stdin';
import { executeCommand } from '../runner';

function parseToData(input: string) {
  const params = parseLanhuUrl(input);
  return {
    teamId: params.teamId,
    projectId: params.projectId,
    imageId: params.docId
  };
}

export const parseCommand = defineCommand({
  meta: {
    name: 'parse',
    description: [
      '解析蓝湖设计稿 URL（或纯 query 串）为 {teamId, projectId, imageId}',
      '',
      '示例:',
      '  lanhu parse "https://lanhuapp.com/web/#/item/project/detailDetach?tid=xxx&pid=xxx&image_id=xxx"',
      '  lanhu parse "tid=xxx&pid=xxx&image_id=xxx" --json',
      '  echo "$URL" | lanhu parse - --json | jq -r .data.imageId',
      '  cat urls.txt | lanhu parse --stdin --keep-going > ids.ndjson'
    ].join('\n')
  },
  args: {
    url: {
      type: 'positional',
      required: false,
      valueHint: 'url|-',
      description:
        '蓝湖设计稿完整 URL、query 串（tid=..&pid=..&image_id=..），或 - 从 stdin 读取；批量用 --stdin'
    },
    ...globalArgs,
    ...batchArgs
  },
  run: ({ args, rawArgs }) =>
    executeCommand({
      command: 'parse',
      kind: 'report',
      args,
      rawArgs,
      handler: async () => {
        let input = args.url;
        if (typeof input !== 'string' || input === '') {
          throw new LanhuError(
            'USAGE_ERROR',
            'missing required argument <url|-> (a Lanhu design URL, or - to read stdin)'
          );
        }
        if (input === '-') {
          input = (await readStdin()).trim();
          if (!input) {
            throw new LanhuError(
              'USAGE_ERROR',
              'stdin was empty; expected a Lanhu design URL'
            );
          }
        }
        const data = parseToData(input);
        return {
          data,
          render: () =>
            [
              `teamId     ${data.teamId}`,
              `projectId  ${data.projectId}`,
              `imageId    ${data.imageId}`
            ].join('\n')
        };
      },
      batchItem: async url => ({ data: parseToData(url) })
    })
});
