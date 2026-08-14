import { defineConfig } from 'vite';

// Library/SSR build like @lanhu-context/core: ESM output for Node >= 20, all
// dependencies (including the linked workspace package @lanhu-context/core)
// external.
export default defineConfig({
  ssr: {
    external: true
  },
  build: {
    ssr: 'src/index.ts',
    target: 'node20',
    outDir: 'dist',
    minify: false,
    sourcemap: false
  }
});
