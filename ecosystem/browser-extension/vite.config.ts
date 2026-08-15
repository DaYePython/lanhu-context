import { defineConfig } from 'vite';

// Shared base only; scripts/build.ts drives one build per entry because MV3
// content scripts must be classic scripts (IIFE) while the service worker
// is declared as an ES module.
export default defineConfig({
  build: {
    target: 'chrome114',
    minify: false,
    emptyOutDir: false
  }
});
