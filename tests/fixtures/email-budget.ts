// tests/fixtures/email-budget.ts — the AD-5 daily send counter is ONE row per real UTC day, shared by every int file.
// A file that sends real (mock) emails puts it back as it found it, so a second run on the same DB doesn't start
// near the ceiling and park other files' sends as 'queued' (pr66-review F4; ics-fallback does the same per test).
import { q } from '@/lib/db';

const TODAY = `(now() at time zone 'utc')::date`;

/** Call in beforeAll; await the returned function in afterAll (before pool().end()). */
export async function saveEmailBudget(): Promise<() => Promise<void>> {
  const [saved] = await q<{ sent_count: number; limit_hit_at: Date | null }>(
    `select sent_count, limit_hit_at from email_budget where utc_day = ${TODAY}`,
  );
  return async () => {
    if (saved) {
      await q(
        `insert into email_budget (utc_day, sent_count, limit_hit_at) values (${TODAY}, $1, $2)
         on conflict (utc_day) do update set sent_count = $1, limit_hit_at = $2`,
        [saved.sent_count, saved.limit_hit_at],
      );
    } else await q(`delete from email_budget where utc_day = ${TODAY}`);
  };
}
