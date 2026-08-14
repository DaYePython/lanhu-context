import { defineConfig } from 'vite';

// Library/SSR build like @lanhu-context/core: ESM output for Node >= 20, all
// dependencies (including the linked workspace package @lanhu-context/core)
// external. Two entries: the library (index) and the `lanhu-context-mcp`
// bin (main). The shebang banner lands on both chunks — a leading hashbang
// is valid ESM, so index.js importing it stays harmless.
export default defineConfig({
  ssr: {
    external: true
  },
  build: {
    ssr: true,
    target: 'node20',
    outDir: 'dist',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        index: 'src/index.ts',
        main: 'src/main.ts'
      },
      output: {
        banner: '#!/usr/bin/env node'
      }
    }
  }
});
