// Hidden-input prompt for interactive credential entry (`lanhu auth set`).
// The prompt text goes to stderr (stdout stays data-only) and the typed
// value is never echoed.

import { createInterface } from 'node:readline';

export function promptHidden(question: string): Promise<string> {
  return new Promise(resolve => {
    process.stderr.write(question);
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true
    });
    // Suppress echo: readline's internal output hook is replaced so typed
    // characters (the secret) are never written anywhere.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput =
      () => {};
    rl.question('', answer => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer.trim());
    });
  });
}
