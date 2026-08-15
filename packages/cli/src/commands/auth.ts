// `lanhu auth set|status|test` — credential management (DESIGN.md §7).
// Tokens never appear on stdout/stderr: status shows only source + masked
// fingerprint, set reads via hidden prompt or stdin.

import { fetchMeta, LanhuError, parseLanhuUrl } from '@lanhu-context/core';
import { defineCommand } from 'citty';
import { globalArgs } from '../args';
import { maskSecret } from '../config/index';
import { writeUserConfig } from '../config/user-config';
import { promptHidden } from '../io/prompt';
import { readStdin } from '../io/stdin';
import { createClient, requireUrlArg, toDesignRequest } from '../lib';
import { executeCommand } from '../runner';

const TOKEN_GUIDE_URL = 'https://lanhu.refineup.com/guide/get-lanhu-token';

// Users paste the Cookie value from DevTools; common paste artifacts
// (a leading `Cookie:` label, surrounding quotes) are stripped so the
// stored token is exactly the header value.
export function normalizeCookieToken(raw: string): string {
  let token = raw.trim();
  token = token.replace(/^cookie\s*:\s*/i, '');
  if (
    token.length >= 2 &&
    ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")))
  ) {
    token = token.slice(1, -1).trim();
  }
  return token;
}

// A browser Cookie header is `k=v; k2=v2; …` — no `=` means the paste is
// almost certainly not the Cookie value (e.g. a URL or a header name).
function looksLikeCookie(token: string): boolean {
  return token.includes('=');
}

function printInteractiveGuide(existing: {
  configured: boolean;
  source?: string;
  fingerprint?: string;
}): void {
  const lines = [
    '获取 LANHU_TOKEN（整段浏览器 Cookie）：',
    '  1. 打开 https://lanhuapp.com 并确认已登录',
    '  2. 打开开发者工具 → Network（网络）→ 刷新页面',
    '  3. 过滤 Fetch/XHR，点任意一个 lanhuapp.com 的请求',
    '  4. 在 Request Headers 里找到 Cookie，只复制 Cookie 后面的整段内容',
    `  图文教程：${TOKEN_GUIDE_URL}`,
    ''
  ];
  if (existing.configured) {
    lines.push(
      `当前已配置 LANHU_TOKEN（${existing.source}  ${existing.fingerprint}），继续将覆盖用户级配置。`,
      ''
    );
  }
  process.stderr.write(`${lines.join('\n')}`);
}

async function promptCookieToken(name: string): Promise<string> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const token = normalizeCookieToken(
      await promptHidden(`${name}（粘贴后按回车确认，输入不会显示在终端）: `)
    );
    if (token && looksLikeCookie(token)) {
      process.stderr.write(`已读取  ${maskSecret(token)}\n`);
      return token;
    }
    if (attempt < MAX_ATTEMPTS) {
      process.stderr.write(
        token
          ? '输入不含 "="，看起来不是 Cookie 内容（应形如 k=v; k2=v2; …），请重新粘贴。\n'
          : '未读到内容（粘贴可能失败），请重新粘贴。\n'
      );
    }
  }
  throw new LanhuError(
    'USAGE_ERROR',
    `连续 3 次未读到有效的 ${name}（应为整段浏览器 Cookie，形如 k=v; k2=v2; …）`,
    { hint: `获取方法见 ${TOKEN_GUIDE_URL}` }
  );
}

const authSetCommand = defineCommand({
  meta: {
    name: 'set',
    description: [
      '写入用户级凭据配置（文件权限 0600）。TTY 下交互输入（隐藏回显）；',
      '非 TTY（CI/脚本）必须用 --token-stdin 从 stdin 读，避免 token 进 argv/shell 历史。',
      '同时传 --token-stdin 与 --dds-token-stdin 时，stdin 第 1 行为 LANHU_TOKEN、第 2 行为 DDS_TOKEN；',
      'TTY 下（无管道）传 --*-stdin 时回落为交互隐藏输入，只提示对应 token。',
      '获取 token 教程：https://lanhu.refineup.com/guide/get-lanhu-token',
      '',
      '示例:',
      '  lanhu auth set',
      '  printf "%s\\n" "$LANHU_TOKEN" | lanhu auth set --token-stdin',
      '  printf "%s\\n%s\\n" "$LANHU_TOKEN" "$DDS_TOKEN" | lanhu auth set --token-stdin --dds-token-stdin'
    ].join('\n')
  },
  args: {
    'token-stdin': {
      type: 'boolean',
      default: false,
      description: '从 stdin 读取 LANHU_TOKEN（非 TTY 环境必须）'
    },
    'dds-token-stdin': {
      type: 'boolean',
      default: false,
      description: '从 stdin 读取 DDS_TOKEN（与 --token-stdin 同用时读第 2 行）'
    },
    ...globalArgs
  },
  run: ({ args, rawArgs }) =>
    executeCommand({
      command: 'auth set',
      kind: 'report',
      args,
      rawArgs,
      handler: async ctx => {
        const tokenFromStdin = args['token-stdin'] === true;
        const ddsFromStdin = args['dds-token-stdin'] === true;
        const interactive = process.stdin.isTTY === true;

        let lanhuToken: string | undefined;
        let ddsToken: string | undefined;

        if ((tokenFromStdin || ddsFromStdin) && !interactive) {
          const lines = (await readStdin())
            .split('\n')
            .map(line => normalizeCookieToken(line))
            .filter(line => line.length > 0);
          let cursor = 0;
          if (tokenFromStdin) lanhuToken = lines[cursor++];
          if (ddsFromStdin) ddsToken = lines[cursor++];
          if (tokenFromStdin && !lanhuToken) {
            throw new LanhuError(
              'USAGE_ERROR',
              'stdin was empty; expected the LANHU_TOKEN on the first line'
            );
          }
          if (ddsFromStdin && !ddsToken) {
            throw new LanhuError(
              'USAGE_ERROR',
              `stdin did not provide the DDS_TOKEN line (expected line ${tokenFromStdin ? 2 : 1})`
            );
          }
        } else if (tokenFromStdin || ddsFromStdin) {
          // *-stdin flags in a TTY (no pipe): reading raw stdin would hang
          // silently, so fall back to hidden prompts for the requested tokens.
          if (tokenFromStdin) {
            printInteractiveGuide({
              configured: ctx.config.token !== undefined,
              source: ctx.config.tokenSource,
              fingerprint: ctx.config.token
                ? maskSecret(ctx.config.token)
                : undefined
            });
            lanhuToken = await promptCookieToken('LANHU_TOKEN');
          }
          if (ddsFromStdin) {
            ddsToken = await promptCookieToken('DDS_TOKEN');
          }
        } else if (interactive) {
          printInteractiveGuide({
            configured: ctx.config.token !== undefined,
            source: ctx.config.tokenSource,
            fingerprint: ctx.config.token
              ? maskSecret(ctx.config.token)
              : undefined
          });
          lanhuToken = await promptCookieToken('LANHU_TOKEN');
          ddsToken = normalizeCookieToken(
            await promptHidden(
              'DDS_TOKEN（可选，直接回车跳过 = 复用 LANHU_TOKEN；输入不会显示在终端）: '
            )
          );
          if (ddsToken) {
            process.stderr.write(`已读取  ${maskSecret(ddsToken)}\n`);
          } else {
            ddsToken = undefined;
          }
        } else {
          throw new LanhuError(
            'USAGE_ERROR',
            '非 TTY 环境不发起交互：请使用 `lanhu auth set --token-stdin`（token 经 stdin 传入，不进 argv/shell 历史）'
          );
        }

        const path = ctx.config.userConfigPath;
        writeUserConfig(path, {
          ...(lanhuToken !== undefined ? { lanhuToken } : {}),
          ...(ddsToken !== undefined ? { ddsToken } : {})
        });

        const updated: string[] = [];
        if (lanhuToken !== undefined) updated.push('LANHU_TOKEN');
        if (ddsToken !== undefined) updated.push('DDS_TOKEN');

        const data = {
          path,
          mode: '0600',
          updated,
          fingerprint: lanhuToken ? maskSecret(lanhuToken) : undefined
        };
        return {
          data,
          render: () =>
            [
              `saved    ${updated.join(', ')} -> ${path} (mode 0600)`,
              ...(data.fingerprint ? [`token    ${data.fingerprint}`] : [])
            ].join('\n'),
          summary: ['运行 `lanhu auth test <url>` 验证 token 活性']
        };
      }
    })
});

const authStatusCommand = defineCommand({
  meta: {
    name: 'status',
    description: [
      '显示凭据状态：token 来源（flag/env/env-file/project-config/user-config）+ 掩码指纹，绝不输出明文。',
      '',
      '示例:',
      '  lanhu auth status',
      '  lanhu auth status --json | jq .data.token.source'
    ].join('\n')
  },
  args: { ...globalArgs },
  run: ({ args, rawArgs }) =>
    executeCommand({
      command: 'auth status',
      kind: 'report',
      args,
      rawArgs,
      handler: async ctx => {
        const { config } = ctx;
        const data = {
          token: {
            configured: config.token !== undefined,
            source: config.tokenSource,
            fingerprint: config.token ? maskSecret(config.token) : undefined
          },
          ddsToken: {
            configured: config.ddsToken !== undefined,
            source: config.ddsTokenSource
          },
          envFilePath: config.envFilePath,
          projectConfigPath: config.projectConfigPath,
          userConfigPath: config.userConfigPath,
          userConfigExists: config.userConfigExists
        };
        return {
          data,
          render: () =>
            [
              `LANHU_TOKEN  ${
                data.token.configured
                  ? `${data.token.source}  ${data.token.fingerprint}`
                  : 'not configured'
              }`,
              `DDS_TOKEN    ${
                data.ddsToken.configured
                  ? `${data.ddsToken.source}（单独配置）`
                  : 'not configured（复用 LANHU_TOKEN）'
              }`,
              `env file     ${data.envFilePath ?? '-'}`,
              `project cfg  ${data.projectConfigPath ?? '-'}`,
              `user cfg     ${data.userConfigPath}${data.userConfigExists ? '' : '（不存在）'}`
            ].join('\n')
        };
      }
    })
});

const authTestCommand = defineCommand({
  meta: {
    name: 'test',
    description: [
      '调一次轻量主站 API（/api/project/image 元数据）验证 token 活性，输出 {ok, checkedAt, hint}。',
      '需要一个设计稿 URL 定位接口参数：位置参数缺省时回退 LANHU_TEST_URL 环境变量。',
      '',
      '示例:',
      '  lanhu auth test "$URL"',
      '  LANHU_TEST_URL="$URL" lanhu auth test --json | jq .data.ok'
    ].join('\n')
  },
  args: {
    url: {
      type: 'positional',
      required: false,
      valueHint: 'url',
      description: '蓝湖设计稿完整 URL 或 query 串（缺省时用 LANHU_TEST_URL）'
    },
    ...globalArgs
  },
  run: ({ args, rawArgs }) =>
    executeCommand({
      command: 'auth test',
      kind: 'report',
      args,
      rawArgs,
      handler: async ctx => {
        const urlArg =
          typeof args.url === 'string' && args.url !== ''
            ? args.url
            : ctx.config.testUrl;
        if (!urlArg) {
          throw new LanhuError(
            'USAGE_ERROR',
            'auth test 需要一个设计稿 URL 来发起轻量 API 请求',
            {
              hint: '传入位置参数 `lanhu auth test "<设计稿URL>"`，或设置 LANHU_TEST_URL 环境变量（任意一个当前账号可见的设计稿 URL 即可）。'
            }
          );
        }
        const url = requireUrlArg(urlArg);
        const params = parseLanhuUrl(url);
        const client = createClient(ctx);
        const meta = await ctx.timed('auth-test', () =>
          fetchMeta(client, toDesignRequest(params))
        );

        const data = {
          ok: true,
          checkedAt: new Date().toISOString(),
          tokenSource: ctx.config.tokenSource,
          design: { name: meta.name, imageId: meta.id },
          hint: 'Token 有效。Token 是浏览器 Cookie，会随登录态过期；失效时重新登录蓝湖复制 Cookie 并运行 `lanhu auth set`。'
        };
        return {
          data,
          render: () =>
            [
              'ok         true',
              `checkedAt  ${data.checkedAt}`,
              `source     ${data.tokenSource}`,
              `design     ${meta.name} (${meta.id.slice(0, 8)})`
            ].join('\n')
        };
      }
    })
});

export const authCommand = defineCommand({
  meta: {
    name: 'auth',
    description: [
      '凭据管理：set（写入用户级配置，0600）/ status（来源 + 掩码指纹）/ test（活性检测）',
      '',
      '示例:',
      '  lanhu auth set',
      '  lanhu auth status --json',
      '  lanhu auth test "$URL"'
    ].join('\n')
  },
  subCommands: {
    set: authSetCommand,
    status: authStatusCommand,
    test: authTestCommand
  }
});
