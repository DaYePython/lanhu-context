import {
  type DesignTokenEntry,
  extractTokenEntries,
  formatDesignTokensCss,
  makeWarning,
  parseLanhuUrl
} from '@lanhu-context/core';
import { defineCommand } from 'citty';
import { globalArgs, toTokensFormat } from '../args';
import { createClient, requireUrlArg, toDesignRequest } from '../lib';
import { executeCommand } from '../runner';

export const tokensCommand = defineCommand({
  meta: {
    name: 'tokens',
    description: [
      '提取 Design Tokens（渐变/边框/圆角/阴影/透明度等易做错的视觉样式值）并输出到 stdout。',
      '--format json（默认）输出结构化条目数组；--format css 输出 :root { --var } CSS variables。',
      '提取不到 tokens 不算失败：输出空结果、退出码 0，缺失原因在 stderr 警告里（--strict 时按失败处理，退出码 8）。',
      '',
      '示例:',
      '  lanhu tokens "$URL" > tokens.json',
      '  lanhu tokens "$URL" --format css > src/styles/design-tokens.css',
      '  lanhu tokens "$URL" --json | jq .data.count'
    ].join('\n')
  },
  args: {
    url: {
      type: 'positional',
      required: false,
      valueHint: 'url',
      description: '蓝湖设计稿完整 URL 或 query 串'
    },
    format: {
      type: 'string',
      valueHint: 'json|css',
      description:
        '输出格式：json（结构化条目）或 css（:root CSS variables），默认 json'
    },
    ...globalArgs
  },
  run: ({ args, rawArgs }) =>
    executeCommand({
      command: 'tokens',
      kind: 'artifact',
      args,
      rawArgs,
      handler: async ctx => {
        const format = toTokensFormat(args);
        const url = requireUrlArg(args.url);
        const params = parseLanhuUrl(url);
        const client = createClient(ctx);

        let entries: DesignTokenEntry[] = [];
        try {
          entries = await ctx.timed('extract-tokens', () =>
            extractTokenEntries(client, toDesignRequest(params))
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.warnings.push(
            makeWarning(
              'TOKENS_UNAVAILABLE',
              `Design tokens could not be extracted: ${message}`
            )
          );
        }
        if (entries.length === 0 && ctx.warnings.length === 0) {
          ctx.warnings.push(
            makeWarning(
              'TOKENS_UNAVAILABLE',
              'No high-risk design tokens found in this design (empty result)'
            )
          );
        }

        const artifact =
          format === 'css'
            ? formatDesignTokensCss(entries)
            : `${JSON.stringify(entries, null, 2)}\n`;

        return {
          data: { format, count: entries.length, tokens: entries },
          artifact
        };
      }
    })
});
