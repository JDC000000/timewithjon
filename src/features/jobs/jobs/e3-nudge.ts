// src/features/jobs/jobs/e3-nudge.ts — T3.9.03: E3 "Still waiting" 24 h into each wait for Jon.
import { sendDueNudges } from '@/features/email/nudge';
import { registerJob } from '../registry';

registerJob({
  name: 'e3-nudge',
  async run(now, deadline) {
    await sendDueNudges(now, deadline);
  },
});
