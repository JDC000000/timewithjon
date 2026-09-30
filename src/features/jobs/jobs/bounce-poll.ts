// src/features/jobs/jobs/bounce-poll.ts — T3.13: polling mode for bounces and complaints (no webhook secret).
import { pollDeliveryOutcomes, pollingSource } from '@/features/email/bounce-poll';
import { registerJob } from '../registry';

registerJob({
  name: 'bounce-poll',
  async run(_now, deadline) {
    const source = await pollingSource();
    if (source) await pollDeliveryOutcomes(source, deadline);
  },
});
