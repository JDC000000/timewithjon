// src/features/jobs/jobs/prune-old-rows.ts — AD-9: rate_limit windows are at most 1 h long; drop old rows
// so the table doesn't grow for the whole season (review T4.2.00 L13). T3.13: webhook_event only dedupes
// redeliveries inside Svix's retry window (hours), so a week is plenty.
import { q } from '@/lib/db';
import { registerJob } from '../registry';

export const WEBHOOK_EVENT_KEEP_DAYS = 7;

registerJob({
  name: 'prune-old-rows',
  async run(now) {
    await q(`delete from rate_limit where window_start < $1::timestamptz - interval '1 day'`, [now]);
    await q(`delete from webhook_event where received_at < $1::timestamptz - make_interval(days => $2)`, [
      now,
      WEBHOOK_EVENT_KEEP_DAYS,
    ]);
  },
});
