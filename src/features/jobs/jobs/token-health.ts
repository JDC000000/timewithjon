// src/features/jobs/jobs/token-health.ts — T3.9.04: the 07:00 PT Google token check (E14 on a revoked grant).
import { checkTokenHealth } from '../token-health';
import { registerJob } from '../registry';

registerJob({
  name: 'token-health',
  async run(now) {
    await checkTokenHealth(now);
  },
});
