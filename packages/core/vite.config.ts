import { defineConfig } from 'vite';

// Library/SSR build: ESM output for Node >= 20, all dependencies external.
export default defineConfig({
  build: {
    ssr: 'src/index.ts',
    target: 'node20',
    outDir: 'dist',
    minify: false,
    sourcemap: false
  }
});
