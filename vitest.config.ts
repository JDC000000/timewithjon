import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Two projects: the node unit tests (unchanged) and the component tests (*.dom.test.tsx, jsdom +
// @testing-library/user-event). `pnpm test` runs both.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          // F4: drain focus.ts settle timers before jsdom teardown ("document is not defined").
          setupFiles: ['./tests/setup-dom.ts'],
          include: ['tests/unit/**/*.dom.test.tsx', 'src/**/*.dom.test.tsx'],
        },
      },
    ],
  },
});
