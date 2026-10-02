// T4.6.04: the Lighthouse gate's own unit tests (tests/lighthouse/score.test.ts). Kept out of the main unit
// project so this lane does not touch vitest.config.ts; the lighthouse workflow runs it before the audits.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'lighthouse', environment: 'node', include: ['tests/lighthouse/**/*.test.ts'] },
});
