import { cpSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist');

interface Target {
  entry: string;
  name: string;
  format: 'es' | 'iife';
}

// MV3: the service worker may be an ES module, content scripts may not.
const targets: Target[] = [
  { entry: 'src/background/index.ts', name: 'background', format: 'es' },
  { entry: 'src/content/index.ts', name: 'content', format: 'iife' }
];

rmSync(outDir, { recursive: true, force: true });

for (const target of targets) {
  await build({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: resolve(root, target.entry),
        name: `lanhuExt_${target.name}`,
        formats: [target.format],
        fileName: () => `${target.name}.js`
      }
    }
  });
}

cpSync(resolve(root, 'public'), outDir, { recursive: true });
console.log(`built -> ${outDir}`);
