// M8: /dev/state scenarios remove only rows they created; social-test requests and stories survive.
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, q, withTx } from '@/lib/db';
import { applyScenario } from '@/features/dev/scenarios';

afterAll(async () => {
  await pool().end();
});

describe('dev scenarios', () => {
  it('a reset keeps real is_test requests and their stories, and clears scenario rows', async () => {
    const [inv] = await q<{ id: string }>(`select id from invite where kind = 'general'`);
    const [g] = await q<{ id: string }>(`insert into guest (email) values ($1) returning id`, [
      `social+${randomUUID().slice(0, 6)}@example.com`,
    ]);
    const [real] = await q<{ id: string }>(
      `insert into request (is_test, client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, status,
                            counts_toward, awaiting_jon_since)
       values (true, gen_random_uuid(), $1, $2, 'Sam', 'sam@example.com', 'the-long-lunch', 'slots', 'requested',
               'weekly_cap', now()) returning id`, // a real state: a new request waits on Jon (pr27-verify V2)
      [g!.id, inv!.id],
    );
    await q(
      `insert into story (source, request_id, body, consent) values ('after_send', $1, 'The halibut incident', true)`,
      [real!.id],
    );

    try {
      await withTx((c) => applyScenario(c, 'full-week'));
      const [n] = await q<{ n: number }>(
        `select count(*)::int n from request where contact_email = 'scenario@example.com'`,
      );
      expect(n!.n).toBe(2);

      await withTx((c) => applyScenario(c, 'empty'));
      const [left] = await q<{ scenario: number; real: number; stories: number }>(
        `select (select count(*)::int from request where contact_email = 'scenario@example.com') scenario,
              (select count(*)::int from request where id = $1) real,
              (select count(*)::int from story where request_id = $1) stories`,
        [real!.id],
      );
      expect(left).toEqual({ scenario: 0, real: 1, stories: 1 });
    } finally {
      // Leave nothing behind: a second `pnpm test:int` on the same DB must see the same rows (V2).
      await q(`delete from story where request_id = $1`, [real!.id]);
      await q(`delete from request where id = $1`, [real!.id]);
      await q(`delete from guest where id = $1`, [g!.id]);
    }
  });
});
