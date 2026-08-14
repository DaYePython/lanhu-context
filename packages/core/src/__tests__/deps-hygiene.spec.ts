// Dependency hygiene check (DESIGN.md §11 M1 DoD): @lanhu-context/core must
// stay free of terminal/protocol dependencies so CLI, MCP, and future API
// layers can all share it.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));

const FORBIDDEN_PATTERNS = [
  /^consola$/,
  /^citty$/,
  /^cleye$/,
  /^commander$/,
  /^picocolors$/,
  /^chalk$/,
  /^express$/,
  /^@modelcontextprotocol\//,
  /^axios$/ // rewritten to ofetch — axios must not sneak back in
];

describe('@lanhu-context/core dependency hygiene', () => {
  test('dependencies contain no terminal or protocol libraries', async () => {
    const pkg = JSON.parse(await readFile(PKG_PATH, 'utf8')) as {
      name: string;
      dependencies?: Record<string, string>;
    };

    expect(pkg.name).toBe('@lanhu-context/core');
    const deps = Object.keys(pkg.dependencies ?? {});
    const violations = deps.filter(dep =>
      FORBIDDEN_PATTERNS.some(pattern => pattern.test(dep))
    );
    expect(violations).toEqual([]);
  });

  test('runtime dependencies are exactly the expected transform/http set', async () => {
    const pkg = JSON.parse(await readFile(PKG_PATH, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual([
      'css-to-tailwindcss',
      'css-to-tailwindcss4',
      'ofetch'
    ]);
  });
});
