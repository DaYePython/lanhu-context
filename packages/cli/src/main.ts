// Bin entry for `lanhu` / `lanhu-context`.
//
// Delegates to citty for help rendering and subcommand dispatch, with two
// pre-dispatch fixes so exit-code semantics follow DESIGN.md §6.2:
// - unknown/missing subcommand is a usage error (exit 2), not citty's
//   generic exit 1;
// - `--version --json` emits {name, version, node}.

import { LanhuError } from '@lanhu-context/core';
import { defineCommand, renderUsage, runMain } from 'citty';
import { assetsCommand } from './commands/assets';
import { authCommand } from './commands/auth';
import { contextCommand } from './commands/context';
import { doctorCommand } from './commands/doctor';
import { htmlCommand } from './commands/html';
import { mcpCommand } from './commands/mcp';
import { metaCommand } from './commands/meta';
import { parseCommand } from './commands/parse';
import { previewCommand } from './commands/preview';
import { schemaCommand } from './commands/schema';
import { tokensCommand } from './commands/tokens';
import { EXIT_USAGE, finishWith } from './exit';
import { failureEnvelope, serializeEnvelope } from './io/envelope';
import { writeStdout } from './io/output';
import { CLI_PKG_NAME, CLI_VERSION } from './version';

const main = defineCommand({
  meta: {
    name: 'lanhu',
    version: CLI_VERSION,
    description:
      '蓝湖设计稿上下文管道工具箱：parse / meta / schema / html / tokens / assets / preview / context / auth / doctor / mcp（`lanhu-context` 为等价全名 bin）'
  },
  subCommands: {
    parse: parseCommand,
    meta: metaCommand,
    schema: schemaCommand,
    html: htmlCommand,
    tokens: tokensCommand,
    assets: assetsCommand,
    preview: previewCommand,
    context: contextCommand,
    auth: authCommand,
    doctor: doctorCommand,
    mcp: mcpCommand
  }
});

const KNOWN_COMMANDS = new Set([
  'parse',
  'meta',
  'schema',
  'html',
  'tokens',
  'assets',
  'preview',
  'context',
  'auth',
  'doctor',
  'mcp'
]);

async function bootstrap(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  // First non-flag token (a lone `-` only appears after a subcommand).
  const firstPositional = rawArgs.find(
    arg => arg === '-' || !arg.startsWith('-')
  );
  const wantsHelp = rawArgs.includes('--help') || rawArgs.includes('-h');

  if (!firstPositional) {
    // Global --version (§4.2); with --json: {name, version, node}.
    if (
      rawArgs.includes('--version') ||
      (rawArgs.length === 1 && rawArgs[0] === '-v')
    ) {
      writeStdout(
        rawArgs.includes('--json')
          ? JSON.stringify({
              name: CLI_PKG_NAME,
              version: CLI_VERSION,
              node: process.version
            })
          : CLI_VERSION
      );
      return;
    }
    if (wantsHelp) {
      await runMain(main, { rawArgs });
      return;
    }
    // No command given: usage goes to stderr, exit 2.
    process.stderr.write(`${await renderUsage(main)}\n`);
    finishWith(EXIT_USAGE);
    return;
  }

  if (!KNOWN_COMMANDS.has(firstPositional)) {
    const error = new LanhuError(
      'USAGE_ERROR',
      `unknown command "${firstPositional}" (expected: parse | meta | schema | html | tokens | assets | preview | context | auth | doctor | mcp)`
    );
    process.stderr.write(
      `USAGE_ERROR: ${error.message}\nhint: ${error.hint}\n`
    );
    if (rawArgs.includes('--json') || process.stdout.isTTY !== true) {
      writeStdout(serializeEnvelope(failureEnvelope(firstPositional, error)));
    }
    finishWith(EXIT_USAGE);
    return;
  }

  await runMain(main, { rawArgs });
}

void bootstrap();
