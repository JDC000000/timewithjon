// src/lib/jobs/registry.ts — AD-8 job runner. Each task registers its job; tick runs them all, small and idempotent.
import 'server-only';
import { report } from '@/lib/report';
import { q } from '@/lib/db';

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
export async function runTick(
  now = new Date(),
): Promise<{ ran: string[]; skipped: string[]; failed: string[] }> {
  const deadline = Date.now() + TICK_BUDGET_MS;
  const ran: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const job of jobs) {
    if (Date.now() > deadline) {
      skipped.push(job.name);
      continue;
    } // rolls to the next tick
    try {
      await job.run(now, deadline);
      ran.push(job.name);
    } catch (e) {
      failed.push(job.name);
      report(e, { area: 'tick', job: job.name });
    }
  }
  await q(
    `insert into system_status (key, value, updated_at) values ('last_tick_at', $1, now())
           on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [now.toISOString()],
  );
  return { ran, skipped, failed };
}
