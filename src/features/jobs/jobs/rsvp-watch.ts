// src/features/jobs/jobs/rsvp-watch.ts — T3.15.01: one events.list per tick (R2-L1), the guest RSVP watch.
import { watchRsvps } from '@/features/calendar/rsvp-watch';
import { registerJob } from '../registry';

registerJob({
  name: 'rsvp-watch',
  async run(now) {
    await watchRsvps(now);
  },
});
