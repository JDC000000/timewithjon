// T2.3 AC1–AC7 + T2.3.08 against the test DB: lockRequest() (T2.3.03), the calendar outbox (T2.3.02), the
// outbox-retry job (T2.3.09) and the /lock route (T2.3.04; /change-time removed 2026-09-29). Each test uses its own season
// week; afterAll removes every request made here, so a re-run on the same DB starts clean.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { pool, q, withTx } from '@/lib/db';
import { removeRequests } from '../fixtures/requests-db';
import { createRequestTx } from '@/features/requests/create';
import { RequestBody } from '@/features/requests/schema';
import { lockRequest, type LockTarget } from '@/features/requests/lock';
import { processOutbox } from '@/features/calendar/outbox';
import { loadManageModel } from '@/features/invites/manage-model';
import { hashActionToken } from '@/features/invites/tokens';
import { runTick } from '@/features/jobs';
import { mockCalendar } from '@/lib/adapters/mock/calendar';
import { vancouverInstant } from '@/lib/time';
import { POST as lockRoute } from '@/app/api/admin/requests/[id]/lock/route';
import { todayCount } from '../fixtures/event-count';

const forceCanLock = { on: false };
vi.mock('@/features/availability/canLock', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/features/availability/canLock')>();
  return {
    ...m,
    canLock: (i: Parameters<typeof m.canLock>[0]) =>
      forceCanLock.on ? { ok: true, warnings: [] } : m.canLock(i),
  };
});
vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
const made: string[] = [];
let inviteId = '';
beforeAll(async () => {
  inviteId = (await q<{ id: string }>(`select id from invite where kind = 'general'`))[0]!.id;
});
afterAll(async () => {
  await removeRequests(made);
  await pool().end();
});

const slotId = async (date: string, w: 'lunch' | 'evening') =>
  (await q<{ id: string }>(`select id from slot where date = $1 and window_kind = $2`, [date, w]))[0]!.id;

async function newRequest(over: { slotIds?: string[]; standbyWeek?: string; note?: string } = {}) {
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name: 'Dave Guest',
    email: `dave+${randomUUID().slice(0, 8)}@example.com`,
    crew: 3,
    slotIds: over.slotIds ?? [],
    standbyWeek: over.standbyWeek,
    note: over.note,
  });
  const { requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId,
      isTest: true,
      spam: false,
      mode: 'slots',
      status: over.standbyWeek ? 'standby' : 'requested',
      countsToward: 'weekly_cap',
      dishName: 'The Long Lunch',
    }),
  );
  made.push(requestId);
  return requestId;
}
const requestRow = async (id: string) =>
  (
    await q<{
      status: string;
      locked_slot_id: string | null;
      locked_starts_at: Date | null;
      google_event_id: string | null;
      calendar_state: string;
      awaiting_jon_since: Date | null;
    }>(
      `select status, locked_slot_id, locked_starts_at, google_event_id, calendar_state, awaiting_jon_since
         from request where id = $1`,
      [id],
    )
  )[0]!;
/**
 * The manage token in the email as sent (dev_outbox, the prototype mock). email_log keeps only the link spec, and
 * no raw token appears in email_log or audit_log; the token row names the email it was minted for.
 */
async function sentManageToken(id: string, template: 'E4'): Promise<string> {
  const [sent] = await q<{ text_body: string }>(
    `select d.text_body from dev_outbox d join request r on r.contact_email = d.to_email
      where r.id = $1 and d.template = $2 order by d.created_at desc limit 1`,
    [id, template],
  );
  const token = /\/manage\?t=([A-Za-z0-9_-]{43})/.exec(sent!.text_body)![1]!;
  const [log] = await q<{ id: string; v: unknown }>(
    `select id, vars->'manageLink' as v from email_log where request_id = $1 and template = $2
      order by created_at desc limit 1`,
    [id, template],
  );
  expect(log!.v).toEqual({ link: 'manage', requestId: id });
  const leaks = await q(
    `select 1 from email_log where vars::text like $1 union all select 1 from audit_log where detail::text like $1`,
    [`%${token}%`],
  );
  expect(leaks).toEqual([]);
  const [minted] = await q<{ e: string }>(
    `select email_log_id::text as e from action_token where token_hash = $1`,
    [hashActionToken(token)],
  );
  expect(minted!.e).toBe(log!.id);
  return token;
}
const emails = (id: string, template: string) =>
  q<{ status: string }>(`select status from email_log where request_id = $1 and template = $2`, [
    id,
    template,
  ]);
const outboxRows = (id: string) =>
  q<{ id: string; kind: string; attempts: number; done_at: Date | null }>(
    `select id, kind, attempts, done_at from outbox where request_id = $1 order by created_at, id`,
    [id],
  );
// Every retry is due, yet before the season (the tick's materialise-done must not end these bookings).
const LATER = new Date('2027-01-01T00:00:00Z');

/** A time change as the calendar sees it (a patch row after the booking's range changed). Change time itself was
 * removed 2026-09-29; the patch path stays for joined guests and must still order behind an unfinished create. */
async function movePatch(id: string, startsAt: Date, endsAt: Date): Promise<string> {
  await q(
    `update request set locked_starts_at = $2, locked_ends_at = $3, locked_slot_id = null where id = $1`,
    [id, startsAt, endsAt],
  );
  const [p] = await q<{ id: string }>(
    `insert into outbox (kind, request_id) values ('calendar_patch', $1) returning id`,
    [id],
  );
  return p!.id;
}
async function slotTimes(id: string): Promise<[Date, Date]> {
  const [s] = await q<{ s: Date; e: Date }>(`select starts_at as s, ends_at as e from slot where id = $1`, [
    id,
  ]);
  return [s!.s, s!.e];
}

describe('lockRequest (T2.3)', () => {
  it('AC1 two concurrent locks on one window: exactly one wins, the other gets "That time just went."', async () => {
    const slot = await slotId('2027-04-08', 'evening');
    const [a, b] = [await newRequest({ slotIds: [slot] }), await newRequest({ slotIds: [slot] })];
    const locks = await todayCount('locked');
    const res = await Promise.all(
      [a, b].map((id) => lockRequest({ requestId: id, target: { slotId: slot }, mode: 'lock' })),
    );
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    expect(res.find((r) => !r.ok)).toMatchObject({
      status: 409,
      reason: 'time_taken',
      message: 'That time just went.',
    });
    const locked = await q(`select 1 from request where locked_slot_id = $1 and status = 'locked'`, [slot]);
    expect(locked).toHaveLength(1);
    expect(await todayCount('locked')).toBe(locks + 1); // T3.11: the loser's count rolled back with it
  });

  it('a double-tapped lock of ONE request into two windows: one wins, the other sees "Already locked in."', async () => {
    const [lunch, evening] = [await slotId('2027-04-09', 'lunch'), await slotId('2027-04-09', 'evening')];
    const id = await newRequest({ slotIds: [lunch, evening] });
    const res = await Promise.all(
      [lunch, evening].map((s) => lockRequest({ requestId: id, target: { slotId: s }, mode: 'lock' })),
    );
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    expect(res.find((r) => !r.ok)).toMatchObject({ status: 409, reason: 'already_locked' });
    expect(await emails(id, 'E4')).toHaveLength(1);
    expect(await outboxRows(id)).toHaveLength(1);
  });

  it('AC2 a Big Day (Fri 09:00–13:00) and a Fri evening slot race: exactly one wins', async () => {
    const evening = await slotId('2027-04-16', 'evening');
    const [bigDay, slotReq] = [await newRequest(), await newRequest({ slotIds: [evening] })];
    const res = await Promise.all([
      lockRequest({
        requestId: bigDay,
        target: {
          startsAt: vancouverInstant('2027-04-16', '09:00'),
          endsAt: vancouverInstant('2027-04-16', '13:00'),
          countsToward: 'big_day',
          where: null,
        },
        mode: 'lock',
      }),
      lockRequest({ requestId: slotReq, target: { slotId: evening }, mode: 'lock' }),
    ]);
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    expect(res.find((r) => !r.ok)).toMatchObject({ status: 409, reason: 'big_day_clash' });
  });

  it('rule 2(e) the other way round: a Big Day by date on a Thursday that already has a slot lock is refused', async () => {
    const lunch = await slotId('2027-04-15', 'lunch');
    expect(
      await lockRequest({
        requestId: await newRequest({ slotIds: [lunch] }),
        target: { slotId: lunch },
        mode: 'lock',
      }),
    ).toMatchObject({ ok: true });
    const bigDay = await newRequest(); // made as weekly_cap: the lock's countsToward decides
    const thu = {
      startsAt: vancouverInstant('2027-04-15', '15:00'),
      endsAt: vancouverInstant('2027-04-15', '16:00'),
      countsToward: 'big_day' as const,
      where: null,
    };
    expect(await lockRequest({ requestId: bigDay, target: thu, mode: 'lock' })).toMatchObject({
      status: 409,
      reason: 'big_day_clash',
    });
    expect(
      await lockRequest({ requestId: bigDay, target: thu, mode: 'lock', bookAnyway: true }),
    ).toMatchObject({ ok: true });
    expect(
      (await q<{ c: string }>(`select counts_toward as c from request where id = $1`, [bigDay]))[0]!.c,
    ).toBe('big_day');
  });

  it('a joined request (T2.10) riding its host has no range of its own and is never locked directly', async () => {
    const s = await slotId('2027-04-15', 'evening');
    const [host, joined] = [await newRequest(), await newRequest({ slotIds: [s] })];
    await q(`update request set status = 'locked', joined_to_request_id = $2 where id = $1`, [joined, host]);
    expect(await lockRequest({ requestId: joined, target: { slotId: s }, mode: 'lock' })).toMatchObject({
      status: 409,
      reason: 'not_lockable',
    });
  });

  it('H1 more concurrent locks in one week than the pool has connections all finish', async () => {
    const targets: LockTarget[] = [
      { slotId: await slotId('2027-04-29', 'lunch') },
      { slotId: await slotId('2027-04-29', 'evening') },
      { slotId: await slotId('2027-04-30', 'lunch') },
      { slotId: await slotId('2027-04-30', 'evening') },
      {
        startsAt: vancouverInstant('2027-04-30', '09:00'),
        endsAt: vancouverInstant('2027-04-30', '10:00'),
        countsToward: 'none',
        where: null,
      },
      {
        startsAt: vancouverInstant('2027-04-29', '09:00'),
        endsAt: vancouverInstant('2027-04-29', '10:00'),
        countsToward: 'none',
        where: null,
      },
    ];
    const ids = await Promise.all(targets.map(() => newRequest()));
    let timer: NodeJS.Timeout | undefined;
    const hung = new Promise<'hung'>((resolve) => (timer = setTimeout(() => resolve('hung'), 10_000)));
    const all = Promise.all(
      ids.map((id, n) => lockRequest({ requestId: id, target: targets[n]!, mode: 'lock' })),
    );
    const res = await Promise.race([all, hung]);
    clearTimeout(timer);
    expect(res).not.toBe('hung');
    const results = res as Awaited<typeof all>;
    expect(results.every((r) => r.ok || r.status === 409)).toBe(true);
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(3); // the cap (2) + the 'none' ones
  }, 20_000);

  it('G2 a repeat Lock in to the SAME slot (leave-commit + window race) is a quiet ok: one E4, one event', async () => {
    const evening = await slotId('2027-06-10', 'evening'); // a week no other test here uses
    const id = await newRequest({ slotIds: [evening] });
    const res = await Promise.all(
      [1, 2].map(() => lockRequest({ requestId: id, target: { slotId: evening }, mode: 'lock' })),
    );
    expect(res.every((r) => r.ok)).toBe(true);
    expect(await lockRequest({ requestId: id, target: { slotId: evening }, mode: 'lock' })).toEqual({
      ok: true,
      warnings: [],
    });
    expect(await emails(id, 'E4')).toHaveLength(1);
    expect(await outboxRows(id)).toHaveLength(1);
    const audits = await q(`select 1 from audit_log where request_id = $1 and action = 'request_locked'`, [
      id,
    ]);
    expect(audits).toHaveLength(1);
  });

  it('L3 with no week row, locks in that week are still serialised (the cap holds under a race)', async () => {
    await q(`delete from week where week_start = '2027-06-28'`);
    try {
      const ids = await Promise.all([1, 2, 3].map(() => newRequest()));
      const hours = [
        ['09:00', '10:00'],
        ['11:00', '12:00'],
        ['13:00', '14:00'],
      ];
      const res = await Promise.all(
        ids.map((id, n) =>
          lockRequest({
            requestId: id,
            target: {
              startsAt: vancouverInstant('2027-06-29', hours[n]![0]!),
              endsAt: vancouverInstant('2027-06-29', hours[n]![1]!),
              countsToward: 'weekly_cap',
              where: null,
            },
            mode: 'lock',
          }),
        ),
      );
      expect(res.filter((r) => r.ok)).toHaveLength(2);
      expect(res.find((r) => !r.ok)).toMatchObject({ reason: 'week_full' });
    } finally {
      await q(`insert into week (week_start) values ('2027-06-28') on conflict do nothing`);
    }
  });

  it('AC3 a third weekly_cap lock is refused without override and goes through with it', async () => {
    const [s1, s2, s3] = [
      await slotId('2027-04-22', 'lunch'),
      await slotId('2027-04-22', 'evening'),
      await slotId('2027-04-23', 'lunch'),
    ];
    for (const s of [s1, s2]) {
      expect(
        await lockRequest({
          requestId: await newRequest({ slotIds: [s] }),
          target: { slotId: s },
          mode: 'lock',
        }),
      ).toMatchObject({ ok: true });
    }
    const third = await newRequest({ slotIds: [s3] });
    expect(await lockRequest({ requestId: third, target: { slotId: s3 }, mode: 'lock' })).toMatchObject({
      ok: false,
      status: 409,
      reason: 'week_full',
    });
    expect((await requestRow(third)).status).toBe('requested'); // a refusal changes nothing
    expect(await outboxRows(third)).toEqual([]);
    expect(
      await lockRequest({ requestId: third, target: { slotId: s3 }, mode: 'lock', overrideWeek: true }),
    ).toMatchObject({ ok: true });
    const [audit] = await q<{ detail: Record<string, unknown> }>(
      `select detail from audit_log where request_id = $1 and action = 'request_locked'`,
      [third],
    );
    expect(audit!.detail).toMatchObject({
      from_status: 'requested',
      to_status: 'locked',
      slot_id: s3,
      override: ['week'],
    });
  });

  it('decision 43(4): a second Something New in one week is refused (week_full) until Override this week', async () => {
    // Week Mon May 3 .. Sun May 9 (no other test in this file uses it). Evenings, like The Encore.
    const sn = async () => {
      const body = RequestBody.parse({
        clientKey: randomUUID(),
        dish: 'something-new',
        name: 'Sam Guest',
        email: `sam+${randomUUID().slice(0, 8)}@example.com`,
        crew: 2,
        dates: ['2027-05-04', '2027-05-08'],
      });
      const { requestId } = await withTx((c) =>
        createRequestTx(c, {
          body,
          inviteId,
          isTest: true,
          spam: false,
          mode: 'dates',
          status: 'requested',
          countsToward: 'weekly_cap',
          dishName: 'Something New',
        }),
      );
      made.push(requestId);
      return requestId;
    };
    const evening = (date: string) => ({
      startsAt: vancouverInstant(date, '19:00'),
      endsAt: vancouverInstant(date, '22:00'),
      where: null,
    });
    const first = await sn();
    expect(
      await lockRequest({ requestId: first, target: evening('2027-05-04'), mode: 'lock' }),
    ).toMatchObject({
      ok: true,
    });
    const second = await sn();
    expect(
      await lockRequest({ requestId: second, target: evening('2027-05-08'), mode: 'lock' }),
    ).toMatchObject({
      ok: false,
      status: 409,
      reason: 'week_full',
    });
    expect((await requestRow(second)).status).toBe('requested');
    expect(
      await lockRequest({
        requestId: second,
        target: evening('2027-05-08'),
        mode: 'lock',
        overrideWeek: true,
      }),
    ).toMatchObject({ ok: true });
  });

  it('AC4 a lock on a request the guest just cancelled gets "They cancelled."', async () => {
    const s = await slotId('2027-05-20', 'lunch');
    const id = await newRequest({ slotIds: [s] });
    await q(
      `update request set status = 'cancelled', cancelled_at = now(), cancelled_by = 'guest' where id = $1`,
      [id],
    );
    expect(await lockRequest({ requestId: id, target: { slotId: s }, mode: 'lock' })).toEqual({
      ok: false,
      status: 409,
      reason: 'cancelled',
      message: 'They cancelled.',
    });
  });

  it('AC5–AC7 a stand-by request locks into its week, E4 goes once', async () => {
    const insert = vi.spyOn(mockCalendar, 'insert');
    const patch = vi.spyOn(mockCalendar, 'patch');
    const friEve = await slotId('2027-05-21', 'evening');
    const id = await newRequest({ standbyWeek: '2027-05-17' });
    expect(await lockRequest({ requestId: id, target: { slotId: friEve }, mode: 'lock' })).toEqual({
      ok: true,
      warnings: [],
    });
    const r = await requestRow(id);
    expect(r).toMatchObject({
      status: 'locked',
      locked_slot_id: friEve,
      calendar_state: 'synced',
      awaiting_jon_since: null,
    });
    expect(r.google_event_id).toMatch(/^mock-/);
    expect(insert).toHaveBeenCalledTimes(1);
    // AC6: once. A repeated tap to the same slot is a quiet ok (PR-G2: the leave-commit may race the window's
    // own POST) and never a second E4.
    expect(await lockRequest({ requestId: id, target: { slotId: friEve }, mode: 'lock' })).toEqual({
      ok: true,
      warnings: [],
    });
    // One E4, sent, with a manage link minted at send time that opens this request's S17 (T2.3.05).
    expect(await emails(id, 'E4')).toEqual([{ status: 'sent' }]);
    const e4Token = await sentManageToken(id, 'E4');
    expect(await loadManageModel(e4Token)).toMatchObject({ kind: 'manage', requestId: id, status: 'locked' });
    expect(
      await q(`select 1 from dev_outbox where template = 'E4' and text_body like '%{manageLink}%'`),
    ).toEqual([]);
    expect((await outboxRows(id)).map((o) => [o.kind, o.attempts, !!o.done_at])).toEqual([
      ['calendar_create', 1, true],
    ]);
    expect(patch).not.toHaveBeenCalled();
    insert.mockRestore();
    patch.mockRestore();
  });

  it('an unknown request or slot is a 404, not a refusal', async () => {
    const s = await slotId('2027-05-20', 'lunch');
    expect(await lockRequest({ requestId: randomUUID(), target: { slotId: s }, mode: 'lock' })).toEqual({
      ok: false,
      status: 404,
      reason: 'request_not_found',
    });
    expect(
      await lockRequest({
        requestId: await newRequest({ slotIds: [s] }),
        target: { slotId: randomUUID() },
        mode: 'lock',
      }),
    ).toEqual({
      ok: false,
      status: 404,
      reason: 'slot_not_found',
    });
  });

  it('the database guards answer "That time just went." if the app check is ever bypassed', async () => {
    const s = await slotId('2027-06-17', 'lunch');
    const [a, b] = [await newRequest({ slotIds: [s] }), await newRequest({ slotIds: [s] })];
    expect(await lockRequest({ requestId: a, target: { slotId: s }, mode: 'lock' })).toMatchObject({
      ok: true,
    });
    forceCanLock.on = true;
    try {
      expect(await lockRequest({ requestId: b, target: { slotId: s }, mode: 'lock' })).toMatchObject({
        status: 409,
        reason: 'time_taken',
      });
      const bRange = await lockRequest({
        requestId: b,
        target: {
          startsAt: vancouverInstant('2027-06-17', '12:30'),
          endsAt: vancouverInstant('2027-06-17', '13:30'),
          countsToward: 'none',
          where: null,
        },
        mode: 'lock',
      });
      expect(bRange).toMatchObject({ status: 409, reason: 'time_taken' }); // the exclusion constraint
    } finally {
      forceCanLock.on = false;
    }
    expect((await requestRow(b)).status).toBe('requested');
  });
});

describe('calendar outbox (T2.3.02, T2.3.08, T2.3.09)', () => {
  it('the event is "{Dish}: {first name}" with crew and where, never the note or the sealed plan', async () => {
    const insert = vi.spyOn(mockCalendar, 'insert');
    const id = await newRequest({ note: 'NOTE-CANARY' });
    await q(
      `update request set surprise_plan_sealed = 'PLAN-CANARY', contact_phone = '555-0100' where id = $1`,
      [id],
    );
    expect(
      await lockRequest({
        requestId: id,
        target: {
          startsAt: vancouverInstant('2027-06-18', '10:00'),
          endsAt: vancouverInstant('2027-06-18', '11:00'),
          countsToward: 'none',
          where: 'The pier',
        },
        mode: 'lock',
      }),
    ).toMatchObject({ ok: true });
    const event = insert.mock.calls[0]![0];
    // Q2 (approved: Jon 2026-10-09): the guest is on the event, so it reads as theirs: "{Dish} with Jon", only the place.
    expect(event).toMatchObject({
      requestId: id,
      summary: 'The Long Lunch with Jon',
      description: 'Where: The pier',
    });
    expect(JSON.stringify(event)).not.toMatch(/CANARY|555-0100/);
    // Q1: Jon set the place, so E4 drops "You pick the place".
    const [e4] = await q<{ vars: Record<string, unknown> }>(
      `select vars from email_log where request_id = $1 and template = 'E4'`,
      [id],
    );
    expect(e4!.vars.placeKnown).toBe(1);
    insert.mockRestore();
  });

  it('T2.3.08 a failure after the Google call does not create a second event; the tick job finishes it', async () => {
    const insert = vi.spyOn(mockCalendar, 'insert');
    const patch = vi.spyOn(mockCalendar, 'patch');
    const s = await slotId('2027-05-27', 'lunch');
    const id = await newRequest({ slotIds: [s] });
    // Fault injection: the write of done_at fails once Google has answered.
    await q(`create or replace function twj_test_fail_done() returns trigger language plpgsql as $$
             begin raise exception 'injected'; end $$`);
    await q(`create trigger twj_test_fail_done before update on outbox for each row
             when (new.done_at is not null) execute function twj_test_fail_done()`);
    try {
      expect(await lockRequest({ requestId: id, target: { slotId: s }, mode: 'lock' })).toMatchObject({
        ok: true,
      }); // the lock stands
    } finally {
      await q(`drop trigger twj_test_fail_done on outbox`);
      await q(`drop function twj_test_fail_done()`);
    }
    const before = await requestRow(id);
    expect(before.google_event_id).toMatch(/^mock-/);
    expect(before.calendar_state).toBe('pending');
    const [row] = await outboxRows(id);
    expect(row).toMatchObject({ attempts: 1, done_at: null });
    expect(await processOutbox(row!.id, { inline: true })).toBe('skipped'); // not due yet, and not a first try
    const tick = await runTick(LATER);
    expect(tick.ran).toContain('outbox-retry');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![0]).toBe(before.google_event_id);
    expect(await requestRow(id)).toMatchObject({
      calendar_state: 'synced',
      google_event_id: before.google_event_id,
    });
    expect((await outboxRows(id))[0]!.done_at).not.toBeNull();
    insert.mockRestore();
    patch.mockRestore();
  });

  it('a create left for the tick is dropped, not sent, if the request was cancelled meanwhile', async () => {
    const insert = vi.spyOn(mockCalendar, 'insert').mockRejectedValueOnce(new Error('google down'));
    const s = await slotId('2027-05-27', 'evening');
    const id = await newRequest({ slotIds: [s] });
    expect(await lockRequest({ requestId: id, target: { slotId: s }, mode: 'lock' })).toMatchObject({
      ok: true,
    });
    await q(
      `update request set status = 'cancelled', cancelled_at = now(), cancelled_by = 'guest' where id = $1`,
      [id],
    );
    await runTick(LATER);
    expect(insert).toHaveBeenCalledTimes(1);
    expect((await outboxRows(id))[0]!.done_at).not.toBeNull();
    expect((await requestRow(id)).google_event_id).toBeNull();
    insert.mockRestore();
  });

  it('L2 a create that finishes while a newer patch row is open does not report synced', async () => {
    const insert = vi.spyOn(mockCalendar, 'insert').mockRejectedValueOnce(new Error('google down'));
    const id = await newRequest();
    const at = (from: string, to: string) => ({
      startsAt: vancouverInstant('2027-06-30', from),
      endsAt: vancouverInstant('2027-06-30', to),
      countsToward: 'none' as const,
      where: null,
    });
    expect(await lockRequest({ requestId: id, target: at('09:00', '10:00'), mode: 'lock' })).toMatchObject({
      ok: true,
    });
    const t = at('11:00', '12:00');
    await movePatch(id, t.startsAt, t.endsAt);
    const [create, patchRow] = await outboxRows(id);
    expect(await processOutbox(create!.id, { inline: false, now: LATER })).toBe('synced');
    expect((await requestRow(id)).calendar_state).toBe('pending'); // the patch row is still open
    expect(await processOutbox(patchRow!.id, { inline: true })).toBe('synced');
    expect((await requestRow(id)).calendar_state).toBe('synced');
    insert.mockRestore();
  });

  it('L1 a last try that died mid-call (no catch ran) is marked failed by the tick', async () => {
    const id = await newRequest();
    const target = {
      startsAt: vancouverInstant('2027-06-30', '14:00'),
      endsAt: vancouverInstant('2027-06-30', '15:00'),
      countsToward: 'none' as const,
      where: null,
    };
    expect(await lockRequest({ requestId: id, target, mode: 'lock' })).toMatchObject({ ok: true });
    // As if the 4th try claimed the row and the function was killed during the Google call.
    await q(`update outbox set done_at = null, attempts = 4, next_attempt_at = now() where request_id = $1`, [
      id,
    ]);
    await q(`update request set calendar_state = 'pending' where id = $1`, [id]);
    await runTick(LATER);
    expect((await requestRow(id)).calendar_state).toBe('failed');
  });

  it('a patch waits for an unfinished create, then both run in order; a fourth failure marks the calendar failed', async () => {
    const insert = vi.spyOn(mockCalendar, 'insert').mockRejectedValueOnce(new Error('google down'));
    const patch = vi.spyOn(mockCalendar, 'patch');
    const [lunch, evening] = [await slotId('2027-05-28', 'lunch'), await slotId('2027-05-28', 'evening')];
    const id = await newRequest({ slotIds: [lunch] });
    expect(await lockRequest({ requestId: id, target: { slotId: lunch }, mode: 'lock' })).toMatchObject({
      ok: true,
    });
    const held = await movePatch(id, ...(await slotTimes(evening)));
    await processOutbox(held, { inline: true });
    expect((await outboxRows(id)).map((o) => [o.kind, o.attempts])).toEqual([
      ['calendar_create', 1],
      ['calendar_patch', 0], // held back behind the retryable create: no second insert can race it
    ]);
    expect(insert).toHaveBeenCalledTimes(1);
    await runTick(LATER);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[1]![0].startsAt).toEqual(
      (await q<{ s: Date }>(`select starts_at as s from slot where id = $1`, [evening]))[0]!.s,
    );
    expect(patch).toHaveBeenCalledTimes(1);
    expect((await outboxRows(id)).every((o) => o.done_at)).toBe(true);
    expect((await requestRow(id)).calendar_state).toBe('synced');

    // Out of attempts: four failures, then calendar_state = 'failed' and the row is left alone.
    patch.mockRejectedValue(new Error('google down'));
    await movePatch(id, ...(await slotTimes(lunch)));
    const last = (await outboxRows(id)).at(-1)!;
    for (let i = 0; i < 4; i++)
      await processOutbox(last.id, { inline: false, now: new Date(LATER.getTime() + i * 3_600_000) });
    expect((await outboxRows(id)).at(-1)).toMatchObject({ attempts: 4, done_at: null });
    expect((await requestRow(id)).calendar_state).toBe('failed');
    expect(patch).toHaveBeenCalledTimes(5); // 1 good, then 4 failed tries; a 5th is never made
    insert.mockRestore();
    patch.mockRestore();
  });
});

describe('POST /api/admin/requests/[id]/lock (T2.3.04)', () => {
  const post = (handler: typeof lockRoute, id: string, body: unknown) =>
    handler(
      new NextRequest(`${SITE}/api/admin/requests/${id}/lock`, {
        method: 'POST',
        headers: { origin: SITE, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );

  it('dates mode: a date, a start and a length (rule 14) become the locked range', async () => {
    const id = await newRequest();
    const res = await post(lockRoute, id, {
      date: '2027-06-18',
      start: '14:00',
      lengthMinutes: 90,
      countsToward: 'none',
      where: ' The beach ',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(await res.json()).toEqual({ ok: true, warnings: [] });
    const [r] = await q<{
      locked_starts_at: Date;
      locked_ends_at: Date;
      locked_where: string;
      counts_toward: string;
    }>(`select locked_starts_at, locked_ends_at, locked_where, counts_toward from request where id = $1`, [
      id,
    ]);
    expect(r).toEqual({
      locked_starts_at: vancouverInstant('2027-06-18', '14:00'),
      locked_ends_at: vancouverInstant('2027-06-18', '15:30'),
      locked_where: 'The beach',
      counts_toward: 'none',
    });
  });

  it('refusals are 409 with the refusal message; bad input is 400; a bad id is 404', async () => {
    const id = await newRequest();
    const past = await post(lockRoute, id, {
      date: '2026-01-01',
      start: '10:00',
      lengthMinutes: 60,
      countsToward: 'none',
    });
    expect(past.status).toBe(409);
    expect(await past.json()).toMatchObject({
      code: 'in_the_past',
      message: 'That time has already passed.',
    });
    for (const bad of [
      {},
      { slotId: 'nope' },
      { date: '2027-06-31', start: '10:00', lengthMinutes: 60, countsToward: 'none' },
      { date: '2027-06-18', start: '10:00', lengthMinutes: 0, countsToward: 'none' },
      { date: '2027-06-18', start: '10:00', countsToward: 'none' }, // all-day: no length (rule 14)
      { slotId: randomUUID(), date: '2027-06-18' },
    ]) {
      expect((await post(lockRoute, id, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await post(lockRoute, 'not-a-uuid', { slotId: randomUUID() })).status).toBe(404);
    expect((await post(lockRoute, randomUUID(), { slotId: randomUUID() })).status).toBe(404);
  });
});
