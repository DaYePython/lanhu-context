import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/__tests__/**/*.spec.ts',
      'ecosystem/*/src/**/__tests__/**/*.spec.ts'
    ],
    globals: true,
    testTimeout: 30_000
  }
});
