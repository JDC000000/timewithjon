// src/lib/jobs/registry.ts — AD-8 job runner. Each task registers its job; tick runs them all, small and idempotent.
// T3.9.01: the 8 s budget decides which jobs START; every Google and mailer call inside a job also stops at
// budget + 1 s (a hard stop), so a hung call can't outlive the route's maxDuration (10 s) and lose the heartbeat.
// Jobs the budget skipped run first on the next tick, so a slow provider can't starve the jobs at the end of the
// list. The heartbeat records how many jobs failed, so /api/health sees a tick where every job throws.
import 'server-only';
import { report } from '@/lib/report';
import { q } from '@/lib/db';
import { withGoogleDeadline } from '@/lib/adapters/google/http';
import { withMailDeadline } from '@/lib/adapters/mail-deadline';

export interface Job {
  name: string;
  run(now: Date, deadline: number): Promise<void>;
}
const jobs: Job[] = [];
export function registerJob(job: Job) {
  if (!jobs.some((j) => j.name === job.name)) jobs.push(job);
}
export function registeredJobs(): readonly Job[] {
  return jobs;
}

export const TICK_BUDGET_MS = 8000;
/** Past the start budget, an outbound call already in flight gets this long before it's cut off. */
export const TICK_HARD_STOP_GRACE_MS = 1000;
/** system_status keys: jobs the last tick skipped (comma list) and its failed count ("failed/attempted"). */
export const TICK_SKIPPED_KEY = 'tick_skipped';
export const TICK_FAILED_KEY = 'last_tick_failed';

/** Last tick's skipped jobs first (in registration order), then the rest. A read error keeps the plain order. */
async function runOrder(): Promise<Job[]> {
  const rows = await q<{ value: string | null }>(`select value from system_status where key = $1`, [
    TICK_SKIPPED_KEY,
  ]).catch(() => []);
  const skipped = new Set((rows[0]?.value ?? '').split(',').filter(Boolean));
  return [...jobs.filter((j) => skipped.has(j.name)), ...jobs.filter((j) => !skipped.has(j.name))];
}

export async function runTick(
  now = new Date(),
  budgetMs = TICK_BUDGET_MS,
): Promise<{ ran: string[]; skipped: string[]; failed: string[] }> {
  const deadline = Date.now() + budgetMs;
  const hardStop = deadline + TICK_HARD_STOP_GRACE_MS;
  const ran: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const job of await runOrder()) {
    if (Date.now() > deadline) {
      skipped.push(job.name);
      continue;
    } // rolls to the next tick, where it runs first
    try {
      await withGoogleDeadline(hardStop, () => withMailDeadline(hardStop, () => job.run(now, deadline)));
      ran.push(job.name);
    } catch (e) {
      failed.push(job.name);
      report(e, { area: 'tick', job: job.name });
    }
  }
  await q(
    `insert into system_status (key, value, updated_at)
          values ('last_tick_at', $1, now()), ($2, $3, now()), ($4, $5, now())
           on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [
      now.toISOString(),
      TICK_SKIPPED_KEY,
      skipped.join(','),
      TICK_FAILED_KEY,
      `${failed.length}/${ran.length + failed.length}`,
    ],
  );
  return { ran, skipped, failed };
}
