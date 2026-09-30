// src/features/jobs/jobs/email-queue.ts — T3.2.05/.06: the AD-5 waits. The next-UTC-day queue, then the
// hourly "What's new" digest (a no-op until P3 email has been parked for it).
import { sendHourlyDigest } from '@/features/email/digest';
import { sendQueuedEmails } from '@/features/email/queue';
import { registerJob } from '../registry';

registerJob({
  name: 'email-queue',
  async run(now, deadline) {
    await sendQueuedEmails(now, deadline);
    await sendHourlyDigest(now);
  },
});
