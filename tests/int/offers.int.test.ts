// T2.4 (lane L1): the offer service (T2.4.01), Suggest another time → E5 (T2.4.02), the guest takes an offer on
// S18 (T2.4.07), and TSD T2.4 AC1, AC4 and AC6, against the test DB with the mock mailer and calendar.
// The clock is 2027-03-15 (after the general release, before the season); each test uses its own season days.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

import { ALREADY, ERRORS } from '@/content';
import { POST as suggestRoute } from '@/app/api/admin/requests/[id]/suggest/route';
import { POST as takeRoute } from '@/app/api/offer/take/route';
import { findToken, issueToken } from '@/features/invites/action-tokens';
import { createRequestTx } from '@/features/requests/create';
import { lockRequest } from '@/features/requests/lock';
import { createOffer, MAX_OFFER_OPTIONS, releaseLiveOffers } from '@/features/requests/offers';
import { RequestBody } from '@/features/requests/schema';
import { suggestTimes } from '@/features/requests/suggest';
import { stillOpen, takeOffer } from '@/features/requests/take-offer';
import { pool, q, withTx } from '@/lib/db';
import { saveEmailBudget } from '../fixtures/email-budget';
import { removeRequests } from '../fixtures/requests-db';
import { resolveLinkVars, takeLink } from '@/features/email/link-vars';
import { SuggestBody } from '@/features/requests/offer-api';
import { vancouverInstant } from '@/lib/time';

const SITE = 'http://localhost:3000';
const NOW = new Date('2027-03-15T18:00:00Z');
const made: string[] = [];
const cappedWeeks: string[] = [];
let inviteId = '';

let restoreBudget = async () => {};
beforeAll(async () => {
  restoreBudget = await saveEmailBudget();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  inviteId = (
    await q<{ id: string }>(`select id from invite where kind = 'general' and revoked_at is null`)
  )[0]!.id;
});
// The offerTake limiter is 10 an hour on one local bucket off Vercel: every test starts with it clear.
beforeEach(async () => {
  await q(`delete from rate_limit where scope = 'offerTake'`);
});
afterAll(async () => {
  vi.useRealTimers();
  await restoreBudget();
  await removeRequests(made); // gone for good: re-runs on one DB stay under admin-inbox's capped Cancelled tab
  await q(`update week set cap_override = null where week_start = any($1::date[])`, [cappedWeeks]);
  await pool().end();
});

const slotId = async (date: string, w: 'lunch' | 'evening' = 'lunch') =>
  (await q<{ id: string }>(`select id from slot where date = $1 and window_kind = $2`, [date, w]))[0]!.id;

async function newRequest(o: { slotIds?: string[]; dish?: string; dates?: string[] } = {}) {
  const dish = o.dish ?? 'the-long-lunch';
  const dates = o.dates ?? [];
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish,
    name: 'Dana Guest',
    email: `dana+${randomUUID().slice(0, 8)}@example.com`,
    crew: 2,
    slotIds: o.slotIds ?? [],
    dates,
  });
  const { requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId,
      isTest: true,
      spam: false,
      mode: dates.length ? 'dates' : 'slots',
      status: 'requested',
      countsToward: 'weekly_cap',
      bigCrew: false,
      dishName: dish,
    }),
  );
  made.push(requestId);
  return { id: requestId, email: body.email };
}

const req = async (id: string) =>
  (
    await q<{
      status: string;
      awaiting_jon_since: Date | null;
      locked_starts_at: Date | null;
      locked_ends_at: Date | null;
    }>(`select status, awaiting_jon_since, locked_starts_at, locked_ends_at from request where id = $1`, [id])
  )[0]!;
const lastMail = async (to: string) =>
  (
    await q<{ subject: string; text_body: string }>(
      `select subject, text_body from dev_outbox where to_email = $1 order by created_at desc limit 1`,
      [to],
    )
  )[0];
const tokenIn = (text: string) => /\/offer\?t=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? null;

async function suggestAndGetToken(id: string, email: string, slotIds: string[]) {
  const res = await suggestTimes(id, { slotIds }, '', NOW);
  expect(res.ok).toBe(true);
  const token = tokenIn((await lastMail(email))!.text_body);
  expect(token).not.toBeNull();
  return { offerId: (res as { offerId: string }).offerId, token: token! };
}

const post = (url: string, body: unknown, origin = SITE) =>
  new NextRequest(`${SITE}${url}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A guest cancel mid-transaction (pr46-49-verify N46-1): it holds the request row, then spends its tokens. */
async function heldCancel(requestId: string, during: () => Promise<unknown>) {
  const a = await pool().connect();
  try {
    await a.query('begin');
    await a.query(`select r.id from request r where r.id = $1 for update`, [requestId]);
    const racing = during(); // waits on the request row (request -> token): no 40P01 either side
    await new Promise((r) => setTimeout(r, 300));
    await releaseLiveOffers(a, requestId);
    await a.query('commit');
    return await racing;
  } catch (e) {
    await a.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    a.release();
  }
}

describe('T2.4.01 createOffer', () => {
  it('stores slots or ranges, never both, and at most 4', async () => {
    const { id } = await newRequest();
    const start = vancouverInstant('2027-06-05', '19:30');
    const range = {
      startsAt: start,
      endsAt: new Date(start.getTime() + 3.5 * 3600e3),
      where: 'The Commodore',
    };
    const offerId = await withTx((c) =>
      createOffer(c, { requestId: id, kind: 'suggested_times', ranges: [range] }),
    );
    const [o] = await q<{ ranges: unknown; slot_ids: string[]; expires_at: Date | null }>(
      `select ranges, slot_ids, expires_at from offer where id = $1`,
      [offerId],
    );
    expect(o).toEqual({
      ranges: [
        { starts_at: start.toISOString(), ends_at: range.endsAt.toISOString(), where: 'The Commodore' },
      ],
      slot_ids: [],
      expires_at: null,
    });
    const slot = await slotId('2027-06-10');
    await expect(
      withTx((c) =>
        createOffer(c, { requestId: id, kind: 'suggested_times', slotIds: [slot], ranges: [range] }),
      ),
    ).rejects.toThrow(RangeError);
    await expect(
      withTx((c) =>
        createOffer(c, {
          requestId: id,
          kind: 'suggested_times',
          ranges: Array.from({ length: MAX_OFFER_OPTIONS + 1 }, () => range),
        }),
      ),
    ).rejects.toThrow(RangeError);
  });
});

describe('T2.4.02 Suggest another time → E5', () => {
  it('moves the request to needs_new_time, clears the wait and sends E5 with the times and one take link', async () => {
    const a = await slotId('2027-06-10');
    const b = await slotId('2027-06-11'); // a lunch: a Long Lunch is never offered an evening (CR-05)
    const { id, email } = await newRequest({ slotIds: [a] });
    const res = await suggestTimes(id, { slotIds: [b, a] }, 'Thursday went before I could grab it.', NOW);
    expect(res.ok).toBe(true);
    const r = await req(id);
    expect(r.status).toBe('needs_new_time');
    expect(r.awaiting_jon_since).toBeNull();
    const mail = (await lastMail(email))!;
    expect(mail.subject).toBe('Another time for The Long Lunch?');
    expect(mail.text_body).toMatch(/^Thursday went before I could grab it\. These are still open:\n/);
    // Earliest first, one line each; then exactly one take link.
    expect(mail.text_body).toMatch(/still open:\nThu Jun 10 · [^\n]+\nFri Jun 11 · [^\n]+\nTap one/); // QA C: the site's style
    expect(mail.text_body.match(/\/offer\?t=/g)).toHaveLength(1);
    // The log keeps the link SPEC, never a token (the rulings: minted at send time).
    const [log] = await q<{ vars: Record<string, unknown>; event_key: string; status: string }>(
      `select vars, event_key, status from email_log where request_id = $1 and template = 'E5'`,
      [id],
    );
    expect(log!.vars.takeLink).toEqual({ link: 'take', offerId: (res as { offerId: string }).offerId });
    expect(log!.event_key).toBe((res as { offerId: string }).offerId);
    expect(log!.status).toBe('sent');
    const t = await findToken(tokenIn(mail.text_body));
    // A suggested_times offer never expires, so its single-use link lasts 14 days from the send (§6).
    expect(t!.expires_at).toEqual(new Date(NOW.getTime() + 14 * 24 * 3600e3));
    expect(t).toMatchObject({
      purpose: 'take_offer',
      request_id: id,
      offer_id: (res as { offerId: string }).offerId,
    });
    const audit = await q<{ actor: string; detail: { to_status: string } }>(
      `select actor, detail from audit_log where request_id = $1 and action = 'times_suggested'`,
      [id],
    );
    expect(audit).toEqual([
      { actor: 'jon', detail: expect.objectContaining({ to_status: 'needs_new_time' }) },
    ]);
  });

  it('a re-suggest releases the earlier offer: its link then shows the current state', async () => {
    const a = await slotId('2027-06-17');
    const b = await slotId('2027-06-18');
    const { id, email } = await newRequest();
    const first = await suggestAndGetToken(id, email, [a]);
    const second = await suggestAndGetToken(id, email, [b]);
    const [o] = await q<{ released_at: Date | null }>(`select released_at from offer where id = $1`, [
      first.offerId,
    ]);
    expect(o!.released_at).not.toBeNull();
    expect(await takeOffer({ token: first.token, slotId: a }, false, NOW)).toBe('done');
    expect((await req(id)).status).toBe('needs_new_time'); // nothing was taken
    expect(await takeOffer({ token: second.token, slotId: b }, false, NOW)).toBe('done');
    expect((await req(id)).status).toBe('locked');
  });

  it('works from stand-by, refuses a locked or cancelled request, an unknown slot and a past time', async () => {
    const slot = await slotId('2027-06-24');
    const { id } = await newRequest();
    await q(`update request set status = 'standby' where id = $1`, [id]);
    expect((await suggestTimes(id, { slotIds: [slot] }, '', NOW)).ok).toBe(true);
    await q(`update request set status = 'cancelled' where id = $1`, [id]);
    expect(await suggestTimes(id, { slotIds: [slot] }, '', NOW)).toMatchObject({
      status: 409,
      reason: 'not_allowed',
    });
    const other = await newRequest();
    expect(await suggestTimes(other.id, { slotIds: [randomUUID()] }, '', NOW)).toMatchObject({
      status: 404,
      reason: 'slot_not_found',
    });
    const past = vancouverInstant('2027-03-01', '12:00');
    expect(
      await suggestTimes(
        other.id,
        { ranges: [{ startsAt: past, endsAt: new Date(+past + 3600e3), where: null }] },
        '',
        NOW,
      ),
    ).toMatchObject({ status: 409, reason: 'in_the_past' });
    expect(await suggestTimes(randomUUID(), { slotIds: [slot] }, '', NOW)).toMatchObject({ status: 404 });
    expect((await req(other.id)).status).toBe('requested');
  });

  it('never offers a time a block shuts (the one block rule) or one outside the season: 409, no offer, no E5', async () => {
    const { id } = await newRequest({ dish: 'the-old-haunt' }); // lunch and evening (CR-05)
    const blocks = await q<{ id: string }>(
      `insert into availability_block (start_date, end_date, kind, window_kind)
       values ('2027-06-06', '2027-06-06', 'blocked', null), ('2027-06-17', '2027-06-17', 'blocked', 'lunch')
       returning id`,
    );
    try {
      const at = (d: string, t: string) => vancouverInstant(d, t);
      // a range running past midnight into a blocked Sunday
      const overMidnight = {
        startsAt: at('2027-06-05', '22:00'),
        endsAt: at('2027-06-06', '01:00'),
        where: null,
      };
      expect(await suggestTimes(id, { ranges: [overMidnight] }, '', NOW)).toMatchObject({
        status: 409,
        reason: 'in_block',
      });
      // a single-window block shuts its own slot, not the evening of that day
      expect(await suggestTimes(id, { slotIds: [await slotId('2027-06-17')] }, '', NOW)).toMatchObject({
        status: 409,
        reason: 'in_block',
      });
      const july = { startsAt: at('2027-07-05', '12:00'), endsAt: at('2027-07-05', '14:00'), where: null };
      expect(await suggestTimes(id, { ranges: [july] }, '', NOW)).toMatchObject({
        status: 409,
        reason: 'out_of_season',
      });
      expect(await q(`select 1 from offer where request_id = $1`, [id])).toEqual([]);
      expect(await q(`select 1 from email_log where request_id = $1 and template = 'E5'`, [id])).toEqual([]);
      expect((await req(id)).status).toBe('requested');
      expect((await suggestTimes(id, { slotIds: [await slotId('2027-06-17', 'evening')] }, '', NOW)).ok).toBe(
        true,
      );
    } finally {
      await q(`delete from availability_block where id = any($1::uuid[])`, [blocks.map((b) => b.id)]);
    }
  });

  it('CR-05: never offers a window the dish does not use (a Long Lunch an evening, an Encore a lunch): 409, no offer, no E5', async () => {
    const lunchDish = await newRequest();
    const encore = await newRequest({ dish: 'the-encore', dates: ['2027-06-19'] });
    const evening = await slotId('2027-06-24', 'evening');
    const lunch = await slotId('2027-06-24', 'lunch');
    for (const [r, slots] of [
      [lunchDish, [evening]],
      [lunchDish, [lunch, evening]], // one misfit refuses the lot
      [encore, [lunch]],
    ] as const) {
      expect(await suggestTimes(r.id, { slotIds: [...slots] }, '', NOW)).toEqual({
        ok: false,
        status: 409,
        reason: 'not_for_this_dish',
      });
      expect(await q(`select 1 from offer where request_id = $1`, [r.id])).toHaveLength(0);
      expect(await lastMail(r.email)).toBeUndefined();
      expect((await req(r.id)).status).toBe('requested');
    }
    // The guest's offer page and take run the same rule (canLock windowRule) for a suggested time; a stand-by offer
    // Jon made with Override keeps its window.
    const shown = [{ slotId: evening, startsAt: new Date(0), endsAt: new Date(0) }];
    expect(await stillOpen(lunchDish.id, shown, 'suggested_times', NOW)).toEqual([]);
    // A misfit suggested offer that exists anyway (made before this rule): the take is refused, nothing locks.
    const offerId = await withTx((c) =>
      createOffer(c, { requestId: lunchDish.id, kind: 'suggested_times', slotIds: [evening] }),
    );
    const token = await withTx((c) =>
      issueToken(c, {
        purpose: 'take_offer',
        requestId: lunchDish.id,
        offerId,
        expiresAt: new Date(NOW.getTime() + 3600e3),
      }),
    );
    expect(await takeOffer({ token, slotId: evening }, false, NOW)).toBe('refused');
    expect((await req(lunchDish.id)).locked_starts_at).toBeNull();
  });

  it('pr46-review M2: refuses a locked request (nothing released, no E5) and a joined one', async () => {
    // The latest slot nothing locked or finished overlaps: other files' bookings stay on a re-run of the same DB.
    const [free] = await q<{ id: string }>(
      `select s.id from slot s
        where not exists (select 1 from request r where r.status in ('locked', 'done')
                            and tstzrange(r.locked_starts_at, r.locked_ends_at) && tstzrange(s.starts_at, s.ends_at))
        order by s.starts_at desc limit 1`,
    );
    const slot = free!.id;
    const locked = await newRequest({ slotIds: [slot] });
    // Jon's overrides: other files' finished bookings may fill this week on a re-run of the same DB.
    const lock = { mode: 'lock', overrideWeek: true, bookAnyway: true, now: NOW } as const;
    expect(await lockRequest({ requestId: locked.id, target: { slotId: slot }, ...lock })).toMatchObject({
      ok: true,
    });
    expect(await suggestTimes(locked.id, { slotIds: [slot] }, '', NOW)).toMatchObject({
      status: 409,
      reason: 'not_allowed',
    });
    expect((await req(locked.id)).status).toBe('locked');
    expect(await q(`select 1 from offer where request_id = $1`, [locked.id])).toHaveLength(0);
    expect(
      await q(`select 1 from email_log where request_id = $1 and template = 'E5'`, [locked.id]),
    ).toHaveLength(0);
    const joined = await newRequest();
    await q(`update request set joined_to_request_id = $2 where id = $1`, [joined.id, locked.id]);
    expect(await suggestTimes(joined.id, { slotIds: [slot] }, '', NOW)).toMatchObject({
      status: 409,
      reason: 'not_allowed',
    });
    expect((await req(joined.id)).status).toBe('requested');
    expect(await q(`select 1 from offer where request_id = $1`, [joined.id])).toHaveLength(0);
  });

  it('pr46-review L4/L5: duplicate slots are refused; a double submit keeps one offer and one E5', async () => {
    const a = await slotId('2027-04-30');
    const b = await slotId('2027-04-30', 'evening');
    expect(SuggestBody.safeParse({ slotIds: [a, a], lead: '' }).success).toBe(false);
    expect(SuggestBody.safeParse({ slotIds: [a, b], lead: '' }).success).toBe(true);
    const { id } = await newRequest({ dish: 'the-old-haunt' }); // lunch and evening (CR-05)
    const first = await suggestTimes(id, { slotIds: [a, b] }, '', NOW);
    const again = await suggestTimes(id, { slotIds: [b, a] }, '', NOW);
    expect(first.ok && again.ok).toBe(true);
    expect(again).toEqual(first);
    const e5 = `select 1 from email_log where request_id = $1 and template = 'E5'`;
    expect(await q(e5, [id])).toHaveLength(1);
    expect(await q(`select 1 from offer where request_id = $1`, [id])).toHaveLength(1);
    const other = await suggestTimes(id, { slotIds: [a] }, '', NOW); // different windows: a real re-suggest
    expect(other).not.toEqual(first);
    expect(await q(e5, [id])).toHaveLength(2);
    const back = await suggestTimes(id, { slotIds: [a, b] }, '', NOW); // the released [a, b] offer doesn't count
    expect(back).not.toEqual(first);
    expect(await q(e5, [id])).toHaveLength(3);
    const range = {
      startsAt: vancouverInstant('2027-04-30', '15:00'),
      endsAt: vancouverInstant('2027-04-30', '17:00'),
      where: null,
    };
    const r1 = await suggestTimes(id, { ranges: [range] }, '', NOW);
    expect(await suggestTimes(id, { ranges: [range] }, '', NOW)).toEqual(r1);
    expect(await q(e5, [id])).toHaveLength(4);
  });

  it('pr46-review H1: a retried E5 renders the byte-identical take link; one token row per email', async () => {
    const slot = await slotId('2027-06-03'); // a lunch, for a Long Lunch (CR-05)
    const { id, email } = await newRequest();
    const { offerId, token } = await suggestAndGetToken(id, email, [slot]);
    const [log] = await q<{ id: string }>(
      `select id from email_log where request_id = $1 and template = 'E5' and event_key = $2`,
      [id, offerId],
    );
    const again = await resolveLinkVars(log!.id, { takeLink: takeLink(offerId) });
    const retry = await resolveLinkVars(log!.id, { takeLink: takeLink(offerId) });
    expect(retry).toEqual(again);
    expect(tokenIn(String(again.takeLink))).toBe(token); // the sent body's link, byte for byte
    expect(await q(`select 1 from action_token where email_log_id = $1`, [log!.id])).toHaveLength(1);
    expect((await findToken(token))!.purpose).toBe('take_offer');
  });

  it('pr46-review L3: a live link on an offer past its own expiry shows the state; nothing is locked', async () => {
    const slot = await slotId('2027-06-03'); // a lunch, for a Long Lunch (CR-05)
    const { id, email } = await newRequest();
    const { offerId, token } = await suggestAndGetToken(id, email, [slot]);
    await q(`update offer set expires_at = $2 where id = $1`, [offerId, new Date(NOW.getTime() - 60e3)]);
    expect(await takeOffer({ token, slotId: slot }, false, NOW)).toBe('done');
    expect((await req(id)).status).toBe('needs_new_time');
    expect(await q(`select 1 from offer where id = $1 and taken_at is not null`, [offerId])).toHaveLength(0);
  });

  it('the admin route: requireAdmin + Origin, strict body, up to 4 windows, ranges from date/start/length', async () => {
    const { id } = await newRequest();
    const slot = await slotId('2027-06-24');
    expect(
      (
        await suggestRoute(
          post(`/api/admin/requests/${id}/suggest`, { slotIds: [slot] }, 'https://evil.example'),
          { params: Promise.resolve({ id }) },
        )
      ).status,
    ).toBe(403);
    const five = await Promise.all(['03', '04', '10', '11', '17'].map((d) => slotId(`2027-06-${d}`)));
    const bad = await suggestRoute(post(`/api/admin/requests/${id}/suggest`, { slotIds: five }), {
      params: Promise.resolve({ id }),
    });
    expect(bad.status).toBe(400);
    const extra = await suggestRoute(
      post(`/api/admin/requests/${id}/suggest`, { slotIds: [slot], requestId: id }),
      { params: Promise.resolve({ id }) },
    );
    expect(extra.status).toBe(400);
    const ok = await suggestRoute(
      post(`/api/admin/requests/${id}/suggest`, {
        ranges: [{ date: '2027-06-19', start: '19:30', lengthMinutes: 210, where: 'The Commodore' }],
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const { offerId } = (await ok.json()) as { offerId: string };
    const [o] = await q<{ ranges: { starts_at: string; ends_at: string }[] }>(
      `select ranges from offer where id = $1`,
      [offerId],
    );
    expect(new Date(o!.ranges[0]!.starts_at)).toEqual(vancouverInstant('2027-06-19', '19:30'));
    expect(new Date(o!.ranges[0]!.ends_at)).toEqual(vancouverInstant('2027-06-19', '23:00'));
    const gone = await suggestRoute(
      post(`/api/admin/requests/${randomUUID()}/suggest`, { slotIds: [slot] }),
      {
        params: Promise.resolve({ id: randomUUID() }),
      },
    );
    expect(gone.status).toBe(404);
  });
});

describe('T2.4.07 the guest takes an offer (S18 POST)', () => {
  it('AC1: taking twice acts once, and the second visit shows the state', async () => {
    const slot = await slotId('2027-05-13');
    const { id, email } = await newRequest();
    const { token, offerId } = await suggestAndGetToken(id, email, [slot]);
    const [first, second] = await Promise.all([
      takeRoute(post('/api/offer/take', { token, slotId: slot })),
      takeRoute(post('/api/offer/take', { token, slotId: slot })),
    ]);
    for (const res of [first, second]) {
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; message: string };
      expect(body.status).toBe('locked');
      expect(body.message).toMatch(/^You’re locked in for Thu May 13 · /);
    }
    const r = await req(id);
    expect(r.status).toBe('locked');
    expect(r.awaiting_jon_since).toBeNull();
    // One lock: one audit row (actor guest), one E4, one calendar create.
    expect(
      await q(`select 1 from audit_log where request_id = $1 and action = 'offer_taken'`, [id]),
    ).toHaveLength(1);
    expect(await q(`select 1 from email_log where request_id = $1 and template = 'E4'`, [id])).toHaveLength(
      1,
    );
    expect(
      await q(`select 1 from outbox where request_id = $1 and kind = 'calendar_create'`, [id]),
    ).toHaveLength(1);
    const [o] = await q<{ taken_at: Date | null; taken_slot_id: string | null; released_at: Date | null }>(
      `select taken_at, taken_slot_id, released_at from offer where id = $1`,
      [offerId],
    );
    expect(o).toMatchObject({ taken_slot_id: slot, released_at: null });
    expect(o!.taken_at).not.toBeNull();
    const [a] = await q<{ actor: string }>(
      `select actor from audit_log where request_id = $1 and action = 'offer_taken'`,
      [id],
    );
    expect(a!.actor).toBe('guest');
    expect(
      await q(`select 1 from audit_log where request_id = $1 and action = 'honeypot_filled'`, [id]),
    ).toEqual([]);
    // A later visit: the same state line (§14.4 S18 "already done").
    const third = (await (await takeRoute(post('/api/offer/take', { token, slotId: slot }))).json()) as {
      message: string;
    };
    expect(third.message).toBe(ALREADY.lockedIn(third.message.slice('You’re locked in for '.length, -1)));
    expect(await q(`select 1 from email_log where request_id = $1 and template = 'E4'`, [id])).toHaveLength(
      1,
    );
  });

  it('AC4: a suggested time taken after its week filled shows the fallback and sets awaiting_jon_since', async () => {
    const full = await slotId('2027-04-22');
    const open = await slotId('2027-04-29');
    const { id, email } = await newRequest();
    const { token } = await suggestAndGetToken(id, email, [full, open]);
    // Fill the week of Apr 19 (cap 1 for this test), then the guest taps the time in it.
    cappedWeeks.push('2027-04-19');
    await q(`update week set cap_override = 1 where week_start = '2027-04-19'`);
    const other = await newRequest({ slotIds: [await slotId('2027-04-23')] });
    expect(
      (
        await lockRequest({
          requestId: other.id,
          target: { slotId: await slotId('2027-04-23') },
          mode: 'lock',
          now: NOW,
        })
      ).ok,
    ).toBe(true);

    const res = await takeRoute(post('/api/offer/take', { token, slotId: full }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; message: string; windows: { slotId: string }[] };
    expect(body).toMatchObject({ code: 'offer_gone', message: ERRORS.offerGone });
    expect(body.windows.map((w) => w.slotId)).toEqual([open]); // the other offered time is still open
    const r = await req(id);
    expect(r.status).toBe('needs_new_time');
    expect(r.awaiting_jon_since).not.toBeNull();
    // The token was not spent: the other time can still be taken.
    expect(await takeOffer({ token, slotId: open }, false, NOW)).toBe('done');
    expect((await req(id)).status).toBe('locked');
    expect((await req(id)).awaiting_jon_since).toBeNull();
  });

  it('AC4: when no offered time is left, the answer is just "Looks like that one went."', async () => {
    const slot = await slotId('2027-05-27');
    const { id, email } = await newRequest();
    const { token } = await suggestAndGetToken(id, email, [slot]);
    const rival = await newRequest({ slotIds: [slot] });
    expect(
      (await lockRequest({ requestId: rival.id, target: { slotId: slot }, mode: 'lock', now: NOW })).ok,
    ).toBe(true);
    const res = await takeRoute(post('/api/offer/take', { token, slotId: slot, hp: 'bot text' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'offer_gone', message: ERRORS.offerGone, windows: [] });
    expect((await req(id)).awaiting_jon_since).not.toBeNull();
    expect((await findToken(token))!.used_at).toBeNull(); // un-spent
    // pr46-review L2: the AD-9 record survives a refusal
    expect(
      await q(`select actor, detail from audit_log where request_id = $1 and action = 'honeypot_filled'`, [
        id,
      ]),
    ).toEqual([{ actor: 'guest', detail: { offer_id: expect.any(String) } }]);
  });

  it('AC6: a dates-mode offer (the Encore, Sat May 22, 19:30–23:00) can be taken and auto-locks', async () => {
    const { id, email } = await newRequest({ dish: 'the-encore', dates: ['2027-05-21'] });
    const startsAt = vancouverInstant('2027-05-22', '19:30');
    const endsAt = vancouverInstant('2027-05-22', '23:00');
    const res = await suggestTimes(id, { ranges: [{ startsAt, endsAt, where: 'The Commodore' }] }, '', NOW);
    expect(res.ok).toBe(true);
    const mail = (await lastMail(email))!;
    expect(mail.text_body).toMatch(/still open:\nSat May 22 · /);
    const token = tokenIn(mail.text_body)!;
    const answer = await takeRoute(post('/api/offer/take', { token, rangeIndex: 0 }));
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as { message: string }).message).toMatch(
      /^You’re locked in for Sat May 22 · 7:30–11 pm\./,
    );
    const r = await req(id);
    expect(r).toMatchObject({ status: 'locked', locked_starts_at: startsAt, locked_ends_at: endsAt });
    const [w] = await q<{ locked_where: string }>(`select locked_where from request where id = $1`, [id]);
    expect(w!.locked_where).toBe('The Commodore');
    const [o] = await q<{ taken_range: unknown; taken_slot_id: string | null }>(
      `select taken_range, taken_slot_id from offer where request_id = $1 and taken_at is not null`,
      [id],
    );
    expect(o).toEqual({
      taken_range: {
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        where: 'The Commodore',
      },
      taken_slot_id: null,
    });
  });

  it("refuses a window another guest's live stand-by offer holds (Jon only gets a warning)", async () => {
    const slot = await slotId('2027-05-06');
    const { id, email } = await newRequest();
    const { token } = await suggestAndGetToken(id, email, [slot]);
    const holder = await newRequest();
    await withTx((c) =>
      createOffer(c, {
        requestId: holder.id,
        kind: 'standby_open',
        slotIds: [slot],
        expiresAt: new Date(NOW.getTime() + 48 * 3600e3),
      }),
    );
    expect(await takeOffer({ token, slotId: slot }, false, NOW)).toBe('refused');
    expect((await req(id)).status).toBe('needs_new_time');
  });

  it('a lock releases the live offers; the old link then shows the state', async () => {
    const a = await slotId('2027-06-04');
    const b = await slotId('2027-04-15');
    const { id, email } = await newRequest();
    const { token, offerId } = await suggestAndGetToken(id, email, [a]);
    expect((await lockRequest({ requestId: id, target: { slotId: b }, mode: 'lock', now: NOW })).ok).toBe(
      true,
    );
    const [o] = await q<{ released_at: Date | null }>(`select released_at from offer where id = $1`, [
      offerId,
    ]);
    expect(o!.released_at).not.toBeNull();
    expect(await takeOffer({ token, slotId: a }, false, NOW)).toBe('done');
    expect(
      (await q<{ locked_slot_id: string }>(`select locked_slot_id from request where id = $1`, [id]))[0]!
        .locked_slot_id,
    ).toBe(b);
  });

  it('guards: Origin, a choice outside the offer, a tampered, a wrong-purpose or an expired token; the honeypot is recorded', async () => {
    const slot = await slotId('2027-04-08');
    const { id, email } = await newRequest();
    const { token, offerId } = await suggestAndGetToken(id, email, [slot]);
    expect(
      (await takeRoute(post('/api/offer/take', { token, slotId: slot }, 'https://evil.example'))).status,
    ).toBe(403);
    expect((await takeRoute(post('/api/offer/take', { token, slotId: randomUUID() }))).status).toBe(400);
    expect((await takeRoute(post('/api/offer/take', { token, rangeIndex: 0 }))).status).toBe(400);
    expect((await takeRoute(post('/api/offer/take', { token: 'x'.repeat(43), slotId: slot }))).status).toBe(
      404,
    );
    expect((await takeRoute(post('/api/offer/take', { token, slotId: slot, requestId: id }))).status).toBe(
      400,
    );
    const pick = await withTx((c) =>
      issueToken(c, {
        purpose: 'pick_new_date',
        requestId: id,
        offerId,
        expiresAt: new Date(NOW.getTime() + 3600e3),
      }),
    );
    expect((await takeRoute(post('/api/offer/take', { token: pick, slotId: slot }))).status).toBe(400);
    expect((await findToken(pick))!.used_at).toBeNull(); // rolled back, not spent
    expect((await req(id)).status).toBe('needs_new_time');
    expect(
      await q(`select used_at from action_token where offer_id = $1 and used_at is not null`, [offerId]),
    ).toHaveLength(0);

    await q(`update action_token set expires_at = $2 where offer_id = $1`, [
      offerId,
      new Date('2026-01-01T00:00:00Z'), // before the real clock too: consumeToken compares with now()
    ]);
    const stale = await takeRoute(post('/api/offer/take', { token, slotId: slot }));
    expect(stale.status).toBe(410);
    expect(await stale.json()).toMatchObject({ message: ERRORS.stale });
    await q(`update action_token set expires_at = $2 where offer_id = $1`, [
      offerId,
      new Date(NOW.getTime() + 3600e3),
    ]);

    const res = await takeRoute(post('/api/offer/take', { token, slotId: slot, hp: 'bot text' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer'); // tokenNoStore
    expect((await req(id)).status).toBe('locked');
    expect(
      await q(`select detail from audit_log where request_id = $1 and action = 'honeypot_filled'`, [id]),
    ).toEqual([{ detail: { offer_id: offerId } }]);
  });

  it('N46-1: a take racing a guest cancel waits on the request row: no deadlock, it answers with the state', async () => {
    const [free] = await q<{ id: string }>(
      `select s.id from slot s
        where s.window_kind = 'lunch' and not exists (select 1 from request r where r.status in ('locked', 'done')
                and tstzrange(r.locked_starts_at, r.locked_ends_at) && tstzrange(s.starts_at, s.ends_at))
        order by s.starts_at desc limit 1`,
    );
    const { id, email } = await newRequest();
    const { token } = await suggestAndGetToken(id, email, [free!.id]);
    expect(await heldCancel(id, () => takeOffer({ token, slotId: free!.id }, false, NOW))).toBe('done');
    expect((await req(id)).status).toBe('needs_new_time'); // nothing locked: the cancel spent the link first
  });

  it('T2.4.11 AC4: two guests racing for the same last window: one locks it, the other gets the fallback', async () => {
    // pr66-review F3: a window the engine itself says is open (no booking, no live stand-by offer, week not full).
    const candidates = await q<{ id: string; starts_at: Date; ends_at: Date }>(
      `select s.id, s.starts_at, s.ends_at from slot s
        where s.window_kind = 'lunch' and not exists (select 1 from request r where r.status in ('locked', 'done')
                and tstzrange(r.locked_starts_at, r.locked_ends_at) && tstzrange(s.starts_at, s.ends_at))
        order by s.starts_at desc limit 20`,
    );
    const probe = await newRequest();
    const [open] = await stillOpen(
      probe.id,
      candidates.map((s) => ({ slotId: s.id, startsAt: s.starts_at, endsAt: s.ends_at })),
      'suggested_times',
      NOW,
    );
    expect(open).toBeDefined();
    const free = { id: open!.slotId! };
    const a = await newRequest();
    const b = await newRequest();
    const ta = await suggestAndGetToken(a.id, a.email, [free!.id]);
    const tb = await suggestAndGetToken(b.id, b.email, [free!.id]);
    const results = await Promise.all([
      takeOffer({ token: ta.token, slotId: free!.id }, false, NOW),
      takeOffer({ token: tb.token, slotId: free!.id }, false, NOW),
    ]);
    expect([...results].sort()).toEqual(['done', 'refused']);
    const winner = results[0] === 'done' ? a : b;
    const loser = results[0] === 'done' ? { ...b, token: tb.token } : { ...a, token: ta.token };
    expect((await req(winner.id)).status).toBe('locked');
    expect(await req(loser.id)).toMatchObject({ status: 'needs_new_time' });
    expect((await req(loser.id)).awaiting_jon_since).not.toBeNull(); // in Needs a reply
    expect((await findToken(loser.token))!.used_at).toBeNull(); // still usable for another offered time
  });
});
