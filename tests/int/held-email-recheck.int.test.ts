// R6-M2 (evals: held-email-sent-stale, catch-up-pushes-digest): guest emails held by the daily budget (the next-UTC-day queue) are re-checked when they finally go out.
// One that is no longer true is dropped (recorded as stale, never sent, not in Jon's failed list); one still true
// goes out as before. And yesterday's held mail going out this morning doesn't push Jon's notices into the digest.
// The budget row is the real UTC day's (the guard's own clock); the flush runs at a "now" two days on.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { catchUpSentToday } from '@/features/email/budget';
import { sendQueuedEmails } from '@/features/email/queue';
import { deliverEmail, deliverRequestEmails } from '@/features/email/send';
import { STALE_ERROR } from '@/features/email/stale';
import { failedEmails } from '@/features/email/status';
import { createRequestTx } from '@/features/requests/create';
import { cancelByGuest } from '@/features/requests/guest-cancel';
import { joinToBooking } from '@/features/requests/joined';
import { lockRequest } from '@/features/requests/lock';
import { RequestBody } from '@/features/requests/schema';
import { pool, q, withTx } from '@/lib/db';
import { vancouverInstant } from '@/lib/time';
import { removeRequests } from '../fixtures/requests-db';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const NOW = new Date('2027-03-15T18:00:00Z');
const DAYS = ['2027-05-30', '2027-05-31', '2027-06-01'];
const made: string[] = [];
let inviteId = '';

/** Today's (real UTC day) sends set to `n`: 99 holds every guest email, 0 lets everything go. */
const sends = (n: number) =>
  q(
    `insert into email_budget (utc_day, sent_count) values ((now() at time zone 'utc')::date, $1)
     on conflict (utc_day) do update set sent_count = $1, limit_hit_at = null`,
    [n],
  );
const flush = () => sendQueuedEmails(new Date(Date.now() + 2 * 864e5), Date.now() + 60_000, 200);
const emails = async (id: string) =>
  q<{ template: string; status: string; last_error: string | null }>(
    `select template, status::text as status, last_error from email_log
      where request_id = $1 and template not in ('E2', 'E12', 'E16') order by created_at, template`,
    [id],
  );

beforeAll(async () => {
  inviteId = (
    await q<{ id: string }>(`select id from invite where kind = 'general' order by created_at limit 1`)
  )[0]!.id;
  await q(
    `update request set status = 'cancelled', cancelled_at = now()
      where status in ('locked', 'done') and (locked_starts_at at time zone 'America/Vancouver')::date = any($1::date[])`,
    [DAYS],
  );
});
beforeEach(async () => {
  await q(`delete from email_queue`);
  await sends(0);
});
afterAll(async () => {
  await q(`delete from email_queue`);
  await q(`delete from email_budget`);
  await removeRequests(made);
  await pool().end();
});

async function newRequest() {
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name: 'Held Guest',
    email: `held+${randomUUID().slice(0, 8)}@example.com`,
    crew: 1,
  });
  const { requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId,
      isTest: true,
      spam: false,
      mode: 'slots',
      status: 'requested',
      countsToward: 'weekly_cap',
      dishName: 'The Long Lunch',
    }),
  );
  made.push(requestId);
  return requestId;
}
const at = (date: string, from: string, to: string) => ({
  startsAt: vancouverInstant(date, from),
  endsAt: vancouverInstant(date, to),
  countsToward: 'none' as const,
  where: null,
});

describe('held guest emails are re-checked when they go out (R6-M2)', () => {
  it('a guest who cancelled while their "Locked in" waited gets only the cancel, never the stale "Locked in"', async () => {
    const id = await newRequest();
    await sends(99); // everything waits for tomorrow
    expect(
      (
        await lockRequest({
          requestId: id,
          target: at('2027-05-30', '10:00', '11:00'),
          mode: 'lock',
          now: NOW,
        })
      ).ok,
    ).toBe(true);
    expect(await cancelByGuest(id, NOW)).toMatchObject({ ok: true });
    await sends(0);
    await flush();
    const byTemplate = Object.fromEntries((await emails(id)).map((e) => [e.template, e]));
    expect(byTemplate.E4).toMatchObject({ status: 'failed', last_error: STALE_ERROR });
    expect(byTemplate.E11).toMatchObject({ status: 'sent' });
    // Dropped on purpose: nothing for Jon to re-send.
    expect((await failedEmails(500)).filter((f) => f.requestId === id)).toEqual([]);
  });

  it('a "Locked in" for a time the booking has since moved from is dropped; one at the time it still has goes', async () => {
    const moved = await newRequest();
    const kept = await newRequest();
    await sends(99);
    const at10 = at('2027-05-30', '14:00', '15:00');
    expect((await lockRequest({ requestId: moved, target: at10, mode: 'lock', now: NOW })).ok).toBe(true);
    expect(
      (
        await lockRequest({
          requestId: kept,
          target: at('2027-05-30', '16:00', '17:00'),
          mode: 'lock',
          now: NOW,
        })
      ).ok,
    ).toBe(true);
    // The booking now sits at another time (as after an unlock and a lock elsewhere).
    await q(`update request set locked_starts_at = $2, locked_ends_at = $3 where id = $1`, [
      moved,
      vancouverInstant('2027-05-30', '18:00'),
      vancouverInstant('2027-05-30', '19:00'),
    ]);
    await sends(0);
    await flush();
    expect((await emails(moved)).find((e) => e.template === 'E4')).toMatchObject({
      status: 'failed',
      last_error: STALE_ERROR,
    });
    expect((await emails(kept)).find((e) => e.template === 'E4')).toMatchObject({ status: 'sent' });
  });

  it('a joined guest whose host left gets "That plan fell through", not the stale "Locked in" for that plan', async () => {
    const host = await newRequest();
    expect(
      (
        await lockRequest({
          requestId: host,
          target: at('2027-05-31', '10:00', '11:00'),
          mode: 'lock',
          now: NOW,
        })
      ).ok,
    ).toBe(true);
    const guest = await newRequest();
    await sends(99);
    expect(await joinToBooking(guest, host, NOW)).toMatchObject({ ok: true }); // their E4 waits
    expect(await cancelByGuest(host, NOW)).toMatchObject({ ok: true }); // their E5j waits too
    await sends(0);
    await flush();
    const g = Object.fromEntries((await emails(guest)).map((e) => [e.template, e]));
    expect(g.E4).toMatchObject({ status: 'failed', last_error: STALE_ERROR });
    expect(g.E5j).toMatchObject({ status: 'sent' });
  });

  it('a "Got it" (E1) still waiting after the booking was locked and its "Locked in" went out is dropped', async () => {
    const id = await newRequest();
    await sends(99);
    await deliverRequestEmails(id); // E1 parked for tomorrow
    await sends(0);
    expect(
      (
        await lockRequest({
          requestId: id,
          target: at('2027-06-01', '10:00', '11:00'),
          mode: 'lock',
          now: NOW,
        })
      ).ok,
    ).toBe(true);
    expect((await emails(id)).find((e) => e.template === 'E4')).toMatchObject({ status: 'sent' });
    await flush();
    expect((await emails(id)).find((e) => e.template === 'E1')).toMatchObject({
      status: 'failed',
      last_error: STALE_ERROR,
    });
  });

  it('a held email that is still true goes out (and counts as this morning’s catch-up)', async () => {
    const id = await newRequest();
    await sends(99);
    await deliverRequestEmails(id); // E1 parked
    expect((await emails(id)).find((e) => e.template === 'E1')).toMatchObject({ status: 'queued' });
    await sends(0);
    const before = await catchUpSentToday();
    await flush();
    expect((await emails(id)).find((e) => e.template === 'E1')).toMatchObject({
      status: 'sent',
      last_error: null,
    });
    expect(await catchUpSentToday()).toBeGreaterThan(before);
  });

  it('this morning’s catch-up sends don’t push Jon’s notices into the digest; past the moved threshold they still go', async () => {
    const id = await newRequest();
    await sends(99);
    await deliverRequestEmails(id); // E1 and E2 (Jon's) parked
    await sends(0);
    await flush(); // the catch-up goes out today
    const c = await catchUpSentToday();
    expect(c).toBeGreaterThan(0);
    const e2 = async (count: number) => {
      const r = await newRequest();
      const [row] = await q<{ id: string }>(
        `select id from email_log where request_id = $1 and template = 'E2'`,
        [r],
      );
      await sends(count);
      await deliverEmail(row!.id, { inline: true }); // Jon's notice alone (the guest's E1 would take a slot first)
      // A parked email reads 'queued' in email_log; its email_queue row says which wait: the digest or tomorrow.
      const [r2] = await q<{ status: string; kind: string | null }>(
        `select l.status::text as status, eq.kind from email_log l left join email_queue eq on eq.email_log_id = l.id
          where l.id = $1`,
        [row!.id],
      );
      return r2!.status === 'sent' ? 'sent' : r2!.kind;
    };
    expect(await e2(60 + c - 1)).toBe('sent'); // over 60, but within the catch-up: not a digest
    expect(await e2(60 + c)).toBe('digest'); // the moved threshold still holds
  });
});
