// src/features/jobs/jobs/outbox-retry.ts — T2.3.09 (AD-6, L-3): re-run calendar outbox rows a request left
// unfinished (a crash after commit, or a Google error) at +5/+15/+30 min.
import { retryDueOutbox } from '@/features/calendar/outbox';
import { registerJob } from '../registry';

registerJob({
  name: 'outbox-retry',
  async run(now, deadline) {
    await retryDueOutbox(now, deadline);
  },
});
