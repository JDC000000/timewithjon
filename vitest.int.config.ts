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
    globals: true,
    environment: 'node',
    include: ['tests/int/**/*.int.test.ts'],
    setupFiles: ['tests/setup-int.ts'],
    fileParallelism: false,
  },
});
