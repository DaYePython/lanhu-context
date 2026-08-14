// stdout channel rules (DESIGN.md §5): report commands auto-enable JSON when
// stdout is not a TTY; artifact commands always emit the raw artifact unless
// --json is passed explicitly.

export type CommandKind = 'report' | 'artifact';

export function shouldEmitJson(
  kind: CommandKind,
  explicitJson: boolean,
  stdoutIsTTY: boolean
): boolean {
  if (explicitJson) return true;
  return kind === 'report' && !stdoutIsTTY;
}

export function writeStdout(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}
