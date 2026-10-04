// T3.13 / T1.10.03: the pruning jobs drop webhook_event rows older than a week and, in the prototype, dev_outbox
// copies older than a week; newer rows stay.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { q } from '@/lib/db';
import { registeredJobs } from '@/features/jobs';

const DAY = 24 * 3600_000;
const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const job = (name: string) => registeredJobs().find((j) => j.name === name)!;
const tag = `prune-test-${randomUUID()}`;

afterAll(async () => {
  await q(`delete from webhook_event where id like $1`, [`${tag}%`]);
  await q(`delete from dev_outbox where template = $1`, [tag]);
});

describe('pruning jobs', () => {
  it('prune-old-rows: webhook_event older than 7 days goes, newer stays', async () => {
    await q(`insert into webhook_event (id, received_at) values ($1, $2), ($3, $4)`, [
      `${tag}-old`,
      ago(8),
      `${tag}-new`,
      ago(6),
    ]);
    await job('prune-old-rows').run(now, Date.now() + 5_000);
    const left = await q<{ id: string }>(`select id from webhook_event where id like $1 order by id`, [
      `${tag}%`,
    ]);
    expect(left.map((r) => r.id)).toEqual([`${tag}-new`]);
  });

  it('prune-dev-outbox: copies older than 7 days go, newer stay (prototype)', async () => {
    for (const [subject, at] of [
      ['old', ago(8)],
      ['new', ago(1)],
    ] as const)
      await q(
        `insert into dev_outbox (template, to_email, subject, text_body, created_at)
           values ($1, 'guest@example.com', $2, 'body', $3)`,
        [tag, subject, at],
      );
    await job('prune-dev-outbox').run(now, Date.now() + 5_000);
    const left = await q<{ subject: string }>(`select subject from dev_outbox where template = $1`, [tag]);
    expect(left.map((r) => r.subject)).toEqual(['new']);
  });
});
