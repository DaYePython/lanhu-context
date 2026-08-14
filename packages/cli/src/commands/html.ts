import {
  fetchMeta,
  fetchSchema,
  LanhuError,
  makeWarning,
  parseLanhuUrl,
  renderHtml,
  type SchemaNode
} from '@lanhu-context/core';
import { defineCommand } from 'citty';
import { globalArgs, toTransformOptions, transformArgs } from '../args';
import { readStdin } from '../io/stdin';
import { createClient, requireUrlArg, toDesignRequest } from '../lib';
import { executeCommand } from '../runner';

export const htmlCommand = defineCommand({
  meta: {
    name: 'html',
    description: [
      'DDS schema → HTML+CSS（或 Tailwind），stdout 直出 HTML（产物流）。',
      '传 - 时从 stdin 读取 schema JSON 做离线转换，不请求蓝湖 API。',
      '',
      '示例:',
      '  lanhu html "$URL" > page.html',
      '  lanhu html - --tailwind --tw-version 4 < page.schema.json > page.html',
      '  lanhu html "$URL" --skip-slices --unit-scale 0.5',
      '  lanhu html "$URL" --assets-dir ./assets/lanhu --json | jq -r .data.html'
    ].join('\n')
  },
  args: {
    url: {
      type: 'positional',
      required: false,
      valueHint: 'url|-',
      description: '蓝湖设计稿 URL，或 - 从 stdin 读取 schema JSON（离线）'
    },
    ...globalArgs,
    ...transformArgs
  },
  run: ({ args, rawArgs }) =>
    executeCommand({
      command: 'html',
      kind: 'artifact',
      args,
      rawArgs,
      handler: async ctx => {
        const transform = toTransformOptions(args);
        const input = requireUrlArg(args.url, { allowStdin: true });

        let schema: SchemaNode;
        let designName = 'design';
        if (input === '-') {
          // Offline mode: stdin carries the schema; no API access, no token.
          const raw = await readStdin();
          if (!raw.trim()) {
            throw new LanhuError(
              'USAGE_ERROR',
              'stdin was empty; expected DDS schema JSON (e.g. from `lanhu schema`)'
            );
          }
          try {
            schema = JSON.parse(raw) as SchemaNode;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            throw new LanhuError(
              'USAGE_ERROR',
              `stdin is not valid schema JSON: ${message}`
            );
          }
        } else {
          const params = parseLanhuUrl(input);
          const request = toDesignRequest(params);
          const client = createClient(ctx);
          const meta = await ctx.timed('fetch-meta', () =>
            fetchMeta(client, request)
          );
          designName = meta.name;
          schema = await ctx.timed('fetch-schema', () =>
            fetchSchema(client, request)
          );
        }

        const rendered = await ctx.timed('render-html', () =>
          renderHtml(schema, {
            unitScale: transform.unitScale,
            skipSlices: transform.skipSlices,
            designName,
            assetsDir: transform.assetsDir,
            tailwind: transform.tailwind,
            twVersion: transform.twVersion
          })
        );
        if (rendered.tailwindFallback) {
          const cause = rendered.tailwindFallbackError;
          const message =
            cause instanceof Error ? cause.message : String(cause);
          ctx.warnings.push(
            makeWarning(
              'TAILWIND_FALLBACK',
              `Tailwind v${transform.twVersion} conversion failed; kept original HTML+CSS: ${message}`
            )
          );
        }

        return {
          data: {
            html: rendered.html,
            assetsMapping: rendered.assetsMapping,
            tailwindFallback: rendered.tailwindFallback
          },
          artifact: rendered.html
        };
      }
    })
});
