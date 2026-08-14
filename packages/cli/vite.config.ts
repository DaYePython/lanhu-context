import { defineConfig } from 'vite';

// Library/SSR build like @lanhu-context/core, plus a shebang banner because
// dist/main.js is the bin entry (`lanhu` / `lanhu-context`).
export default defineConfig({
  ssr: {
    // Keep all runtime dependencies (including the linked workspace package
    // @lanhu-context/core) external — dist/main.js contains CLI code only.
    external: true
  },
  build: {
    ssr: 'src/main.ts',
    target: 'node20',
    outDir: 'dist',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        banner: '#!/usr/bin/env node'
      }
    }
  }
});
