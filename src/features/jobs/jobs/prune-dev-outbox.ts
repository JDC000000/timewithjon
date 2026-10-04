// src/features/jobs/jobs/prune-dev-outbox.ts — T1.10.03: dev_outbox (the prototype mock mailer's copies, which
// carry live action links) keeps a week, then goes. Prototype only: nothing else writes the table.
import { getEnv } from '@/config/env';
import { q } from '@/lib/db';
import { registerJob } from '../registry';

export const DEV_OUTBOX_KEEP_DAYS = 7;

registerJob({
  name: 'prune-dev-outbox',
  async run(now) {
    if (getEnv().APP_MODE !== 'prototype') return;
    await q(`delete from dev_outbox where created_at < $1::timestamptz - make_interval(days => $2)`, [
      now,
      DEV_OUTBOX_KEEP_DAYS,
    ]);
  },
});
