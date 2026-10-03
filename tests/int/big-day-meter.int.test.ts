// QA M2 (investigated, not reproduced): a date-based Big Day lock (The Grind, Sat Apr 3, 9 am for half a day, the
// Lock sheet's own body) moves the Big Days meter by one, and does not use the week's cap (C3 rule 2(e), TSD AC5:
// a Big Day "does not use the cap", so the week of Mar 29 rightly stays "0 of 2").
import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, q, withTx } from '@/lib/db';
import { removeRequests } from '../fixtures/requests-db';
import { bigDayMeter } from '@/features/admin/meter';
import { createRequestTx } from '@/features/requests/create';
import { lockRequest } from '@/features/requests/lock';
import { LockBody, targetFrom } from '@/features/requests/lock-api';
import { RequestBody } from '@/features/requests/schema';
import { vancouverInstant } from '@/lib/time';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const made: string[] = [];
afterAll(async () => {
  await removeRequests(made);
  await pool().end();
});

describe('the Big Days meter (QA M2)', () => {
  it('a Grind date lock counts once on the meter and stays off the week cap', async () => {
    const inviteId = (await q<{ id: string }>(`select id from invite where kind = 'general'`))[0]!.id;
    const before = await bigDayMeter();
    const body = RequestBody.parse({
      clientKey: randomUUID(),
      dish: 'the-grind',
      name: 'Dave Guest',
      email: `dave+${randomUUID().slice(0, 8)}@example.com`,
      crew: 1,
      dates: ['2027-04-03', '2027-04-10'],
    });
    const { requestId } = await withTx((c) =>
      createRequestTx(c, {
        body,
        inviteId,
        isTest: true,
        spam: false,
        mode: 'dates',
        status: 'requested',
        countsToward: 'big_day',
        bigCrew: false,
        dishName: 'The Grind',
      }),
    );
    made.push(requestId);
    const lock = LockBody.parse({
      date: '2027-04-03',
      start: '09:00',
      lengthMinutes: 240,
      countsToward: 'big_day',
    });
    const res = await lockRequest({
      requestId,
      target: targetFrom(lock)!,
      mode: 'lock',
      now: vancouverInstant('2027-03-01', '12:00'),
    });
    expect(res.ok).toBe(true);
    expect(await bigDayMeter()).toEqual({ ...before, count: before.count + 1 });
    // Kept as a Big Day, so the engine never counts it toward the week's 2 (C3 rule 2(e)).
    const [row] = await q<{ counts_toward: string }>(`select counts_toward from request where id = $1`, [
      requestId,
    ]);
    expect(row!.counts_toward).toBe('big_day');
  });
});
