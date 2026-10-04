// src/features/jobs/jobs/prune-rate-limit.ts — AD-9: rate_limit windows are at most 1 day long (most are 1 h;
// storyPageNew and requestSendInvite are 24 h); drop rows older than that so the table doesn't grow for the whole
// season (review T4.2.00 L13). A row is only dropped once its window has ended.
import { q } from '@/lib/db';
import { registerJob } from '../registry';

registerJob({
  name: 'prune-rate-limit',
  async run(now) {
    await q(`delete from rate_limit where window_start < $1::timestamptz - interval '1 day'`, [now]);
  },
});
