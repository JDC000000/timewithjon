// src/features/jobs/jobs/email-retry.ts — L-3: re-send emails left 'pending' (crash after commit) or 'failed'.
import { retryDueEmails } from '@/features/email/send';
import { registerJob } from '../registry';

registerJob({
  name: 'email-retry',
  async run(now, deadline) {
    await retryDueEmails(now, deadline);
  },
});
