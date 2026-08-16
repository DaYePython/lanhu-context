import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crx3 from 'crx3';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'dist', 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error(
    'dist/manifest.json not found; run `pnpm --filter @lanhu-context/browser-extension build` first'
  );
  process.exit(1);
}

// Reuse the CI/local signing key when provided; otherwise crx3 generates
// key.pem on first run (that generated key must never be committed).
const keyPath = process.env.LANHU_EXT_CRX_KEY_FILE ?? resolve(root, 'key.pem');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const artifactsDir = resolve(root, 'artifacts');
mkdirSync(artifactsDir, { recursive: true });
const base = resolve(artifactsDir, `lanhu-context-helper-${pkg.version}`);

await crx3([manifestPath], {
  keyPath,
  crxPath: `${base}.crx`,
  zipPath: `${base}.zip`
});

// The key is account-credential-grade material: it defines the extension id.
chmodSync(keyPath, 0o600);

console.log(`packed -> ${base}.crx`);
console.log(`packed -> ${base}.zip`);
