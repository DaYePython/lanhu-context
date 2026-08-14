// `lanhu doctor` — environment self-check (DESIGN.md §4.1).
// Report-style: every check runs to completion even after failures; the
// overall exit code is 0 when all pass, otherwise the dominant failed
// category (§6.2 classes: 3 config/credentials, 5 network, 7 local IO).

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BASE_URL, DDS_BASE_URL, resolveOutDir } from '@lanhu-context/core';
import { defineCommand } from 'citty';
import { globalArgs } from '../args';
import { dominantExitCode, EXIT_CONFIG, EXIT_IO, EXIT_UPSTREAM } from '../exit';
import { executeCommand, type RunnerContext } from '../runner';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface CheckResult extends DoctorCheck {
  /** §6.2 exit class this check maps to when it fails. */
  exitClass: number;
}

export const NODE_ENGINES = '^20.19.0 || >=22.12.0';

// Manual semver check against the package engines range (no semver dep).
export function nodeVersionSatisfies(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  if (major === 20) return minor >= 19; // ^20.19.0
  if (major === 22) return minor >= 12; // >=22.12.0
  return major >= 23;
}

async function checkReachable(
  name: string,
  origin: string,
  timeoutMs: number
): Promise<CheckResult> {
  try {
    const response = await fetch(origin, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs)
    });
    // Any HTTP response (even 4xx) proves the host is reachable.
    return {
      name,
      ok: true,
      detail: `${origin} reachable (HTTP ${response.status})`,
      exitClass: EXIT_UPSTREAM
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name,
      ok: false,
      detail: `${origin} unreachable: ${message}`,
      exitClass: EXIT_UPSTREAM
    };
  }
}

async function checkDirWritable(
  name: string,
  dir: string,
  exitClass: number
): Promise<CheckResult> {
  const probe = join(dir, `.lanhu-doctor-${randomBytes(4).toString('hex')}`);
  try {
    await writeFile(probe, 'probe');
    await unlink(probe);
    return { name, ok: true, detail: `${dir} is writable`, exitClass };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name,
      ok: false,
      detail: `${dir} is not writable: ${message}`,
      exitClass
    };
  }
}

async function runChecks(
  ctx: RunnerContext,
  outDirFlag?: string
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const timeoutMs = Math.min(ctx.config.timeout, 10_000);

  // 1. node version vs engines.
  const nodeOk = nodeVersionSatisfies(process.version);
  checks.push({
    name: 'node-version',
    ok: nodeOk,
    detail: nodeOk
      ? `${process.version} satisfies ${NODE_ENGINES}`
      : `${process.version} does not satisfy ${NODE_ENGINES} — upgrade Node.js`,
    exitClass: EXIT_CONFIG
  });

  // 2/3. upstream reachability.
  checks.push(await checkReachable('lanhuapp.com', BASE_URL, timeoutMs));
  checks.push(
    await checkReachable('dds.lanhuapp.com', DDS_BASE_URL, timeoutMs)
  );

  // 4. token configured (source only — never the value).
  const tokenOk = ctx.config.token !== undefined;
  checks.push({
    name: 'token',
    ok: tokenOk,
    detail: tokenOk
      ? `LANHU_TOKEN configured (source: ${ctx.config.tokenSource})`
      : 'LANHU_TOKEN not configured — run `lanhu auth set` or write .env.local',
    exitClass: EXIT_CONFIG
  });

  // 5. cwd writable.
  checks.push(await checkDirWritable('cwd-writable', ctx.config.cwd, EXIT_IO));

  // 6. output directory (--out-dir, or the default) is usable.
  checks.push(await checkOutDir(outDirFlag));

  return checks;
}

// Probe the output directory the user will actually write to: the --out-dir
// argument when provided, else the default <cwd>/.lanhu.local. An existing
// directory is probed for writability; a missing one is created and removed
// again to prove it can be created.
export async function checkOutDir(outDirFlag?: string): Promise<CheckResult> {
  const outDir = resolveOutDir(outDirFlag).path;
  if (existsSync(outDir)) {
    return checkDirWritable('out-dir-writable', outDir, EXIT_IO);
  }
  try {
    await mkdir(outDir, { recursive: true });
    await rm(outDir, { recursive: true, force: true });
    return {
      name: 'out-dir-creatable',
      ok: true,
      detail: `${outDir} can be created`,
      exitClass: EXIT_IO
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: 'out-dir-creatable',
      ok: false,
      detail: `${outDir} cannot be created: ${message}`,
      exitClass: EXIT_IO
    };
  }
}

export const doctorCommand = defineCommand({
  meta: {
    name: 'doctor',
    description: [
      '环境自检：node 版本 / lanhuapp.com 与 dds.lanhuapp.com 可达性 / token 配置 /',
      'cwd 可写 / 输出目录可写或可创建（--out-dir 指定要检查的目录，缺省检查默认的',
      '<cwd>/.lanhu.local）。个别检查失败也会全部跑完；全部通过退出码 0，',
      '有失败时退出码取失败最多的类别（3 配置 / 5 网络 / 7 本地 IO）。',
      '',
      '示例:',
      '  lanhu doctor',
      '  lanhu doctor --out-dir .lanhu.local',
      "  lanhu doctor --json | jq '.data.checks[] | select(.ok == false)'"
    ].join('\n')
  },
  args: {
    'out-dir': {
      type: 'string',
      valueHint: 'path',
      description:
        '要检查的输出目录（与 `lanhu context --out-dir` 同义；缺省检查默认的 <cwd>/.lanhu.local）'
    },
    ...globalArgs
  },
  run: ({ args, rawArgs }) =>
    executeCommand({
      command: 'doctor',
      kind: 'report',
      args,
      rawArgs,
      handler: async ctx => {
        const outDirFlag =
          typeof args['out-dir'] === 'string' && args['out-dir'] !== ''
            ? (args['out-dir'] as string)
            : undefined;
        const results = await ctx.timed('doctor-checks', () =>
          runChecks(ctx, outDirFlag)
        );
        const failed = results.filter(check => !check.ok);
        const checks: DoctorCheck[] = results.map(({ name, ok, detail }) => ({
          name,
          ok,
          detail
        }));
        const data = { ok: failed.length === 0, checks };

        return {
          data,
          exitCode:
            failed.length === 0
              ? 0
              : dominantExitCode(failed.map(check => check.exitClass)),
          render: () =>
            [
              ...checks.map(
                check =>
                  `${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(18)} ${check.detail}`
              ),
              '',
              data.ok ? 'all checks passed' : `${failed.length} check(s) failed`
            ].join('\n'),
          summary: failed.map(
            check => `doctor: ${check.name} — ${check.detail}`
          )
        };
      }
    })
});
