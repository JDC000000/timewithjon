// src/features/jobs/jobs/e13-daily.ts — T3.9.05: the 18:00 PT story digest to Jon (only when there's something).
import { sendDailyDigest } from '@/features/email/daily-digest';
import { registerJob } from '../registry';

registerJob({
  name: 'e13-daily',
  async run(now) {
    await sendDailyDigest(now);
  },
});
