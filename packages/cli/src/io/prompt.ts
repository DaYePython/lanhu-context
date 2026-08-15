// Hidden-input prompt for interactive credential entry (`lanhu auth set`).
// The prompt text goes to stderr (stdout stays data-only) and the typed
// value is never echoed.
//
// Implemented with raw-mode stdin instead of readline(terminal:true):
// readline redraws its own line with cursor-control escapes (ESC[1G ESC[0J)
// that erase the prompt text we already printed, leaving a blank line.

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = '\u007f';

export function promptHidden(question: string): Promise<string> {
  return new Promise(resolve => {
    process.stderr.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw === true;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();

    let buffer = '';
    const restore = () => {
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      process.stderr.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n' || ch === CTRL_D) {
          restore();
          resolve(buffer.trim());
          return;
        }
        if (ch === CTRL_C) {
          restore();
          process.exit(130);
        }
        if (ch === BACKSPACE || ch === '\b') {
          buffer = buffer.slice(0, -1);
        } else {
          buffer += ch;
        }
      }
    };
    stdin.on('data', onData);
  });
}
