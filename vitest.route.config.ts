// vitest.route.config.ts — T1.7.11: route-level tests against a REAL prototype server (scripts/test-route.sh).
import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/route/**/*.route.test.ts'],
    setupFiles: ['tests/setup-int.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
