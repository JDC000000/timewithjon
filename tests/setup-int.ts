// tests/setup-int.ts — env for integration tests (prototype mode, loopback DB). Never real secrets.
process.env.APP_MODE = 'prototype';
process.env.DATABASE_URL ??= 'postgres://postgres:test@127.0.0.1:55432/postgres';
process.env.DATABASE_SSL = 'disable'; // loopback test DB only (env.ts refuses it for any other host)
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.ADMIN_EMAILS = 'jon@example.com';
process.env.SESSION_SIGNING_SECRET = 'test-session-secret-test-session-secret-01';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.CRON_SECRET = 'c'.repeat(32);
process.env.DEV_PASSPHRASE = 'dev-pass-for-integration-tests';
process.env.FEATURE_ADMIN_AUTH = '1';

// Every file starts on a fresh UTC-day email counter: the files share one DB, and the sends of earlier files
// would otherwise push later ones past the AD-5 thresholds (60/85/95), so the order of files would matter.
import { beforeAll } from 'vitest';
beforeAll(async () => {
  const { q } = await import('@/lib/db');
  await q('delete from email_queue');
  await q('delete from email_budget');
  // Nor inherits another file's unsent email: a tick's retry batch (20) would spend itself (and the budget) on
  // those rows first, so a file's own retry assertions would depend on which files ran before it.
  await q(`update email_log set attempts = greatest(attempts, 4) where status in ('pending', 'failed')`);
  // HYG/F4: nor another file's (or an earlier run's) leftovers that a sweep at a far-future `now` would act on and
  // pay for from this file's budget (ics-fallback's E4c were parked 'queued'): a due E3 nudge for every request
  // still waiting on Jon (the tick), and open calendar rows with their out-of-tries .ics fallback (retryDueOutbox).
  await q(`update request set nudged_for = awaiting_jon_since
            where awaiting_jon_since is not null and nudged_for is distinct from awaiting_jon_since`);
  await q(`update outbox set done_at = now()
            where done_at is null and kind in ('calendar_create', 'calendar_patch', 'calendar_delete')`);
});
