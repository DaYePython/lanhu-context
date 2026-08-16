import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// The shipped version comes from package.json (managed by changesets);
// the version field in public/manifest.json is only a placeholder.
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const manifestPath = resolve(outDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = pkg.version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`built -> ${outDir}`);
