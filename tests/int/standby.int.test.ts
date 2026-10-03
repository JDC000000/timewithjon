// T2.4 (lane L1): Move to stand-by → E6 (T2.4.03), offer a freed window to one stand-by guest → E7 (T2.4.04), the
// 48-hour expiry job (T2.4.09), and TSD T2.4 AC2 and AC3, against the test DB with the mock mailer and calendar.
// The clock is 2027-03-15 (after the general release, before the season); each test uses its own season days.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

import { ERRORS } from '@/content';
import { POST as standbyRoute } from '@/app/api/admin/requests/[id]/standby/route';
import { POST as standbyOfferRoute } from '@/app/api/admin/requests/[id]/standby-offer/route';
import { POST as takeRoute } from '@/app/api/offer/take/route';
import { engineInput, loadEngineData } from '@/features/availability/load';
import { openWindows } from '@/features/availability/openWindows';
import { runTick } from '@/features/jobs';
import { createRequestTx } from '@/features/requests/create';
import { lockRequest } from '@/features/requests/lock';
import { stillOpen } from '@/features/requests/take-offer';
import { RequestBody } from '@/features/requests/schema';
import { OfferLinkGoneError, resolveLinkVars, takeLink } from '@/features/email/link-vars';
import { deliverEmail, MAX_ATTEMPTS } from '@/features/email/send';
import { failedEmails } from '@/features/email/status';
import {
  expireAllStandbyOffers,
  expireStandbyOffers,
  moveToStandby,
  offerStandbyWindow,
  weekdayName,
} from '@/features/requests/standby';
import { pool, q, withTx } from '@/lib/db';
import { saveEmailBudget } from '../fixtures/email-budget';
import { removeRequests } from '../fixtures/requests-db';
import { vancouverInstant } from '@/lib/time';

const SITE = 'http://localhost:3000';
const NOW = new Date('2027-03-15T18:00:00Z');
const H48 = 48 * 3600e3;
const made: string[] = [];
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
beforeEach(async () => {
  await q(`delete from rate_limit where scope = 'offerTake'`);
});
afterAll(async () => {
  vi.useRealTimers();
  await restoreBudget();
  await removeRequests(made); // gone for good: re-runs on one DB stay under admin-inbox's capped Cancelled tab
  await pool().end();
});

const slotId = async (date: string, w: 'lunch' | 'evening' = 'lunch') =>
  (await q<{ id: string }>(`select id from slot where date = $1 and window_kind = $2`, [date, w]))[0]!.id;

async function newRequest(o: { dish?: string; standbyWeek?: string } = {}) {
  const dish = o.dish ?? 'the-long-lunch';
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish,
    name: 'Sam Standby',
    email: `sam+${randomUUID().slice(0, 8)}@example.com`,
    crew: 2,
    standbyWeek: o.standbyWeek,
  });
  const { requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId,
      isTest: true,
      spam: false,
      mode: 'slots',
      status: o.standbyWeek ? 'standby' : 'requested',
      countsToward: 'weekly_cap',
      bigCrew: false,
      dishName: dish,
    }),
  );
  made.push(requestId);
  return { id: requestId, email: body.email };
}
const standbyGuest = (dish?: string) => newRequest({ dish, standbyWeek: '2027-05-03' });

const req = async (id: string) =>
  (
    await q<{ status: string; standby_week: string | null; awaiting_jon_since: Date | null }>(
      `select status, standby_week::text, awaiting_jon_since from request where id = $1`,
      [id],
    )
  )[0]!;
const lastMail = async (to: string) =>
  (
    await q<{ subject: string; text_body: string }>(
      `select subject, text_body from dev_outbox where to_email = $1 order by created_at desc limit 1`,
      [to],
    )
  )[0];
const tokenIn = (text: string) => /\/offer\?t=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? null;
const post = (url: string, body: unknown) =>
  new NextRequest(`${SITE}${url}`, {
    method: 'POST',
    headers: { origin: SITE, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('T2.4.03 Move to stand-by → E6', () => {
  it('requested → standby for the week (its Monday), the wait cleared, E6 names the week', async () => {
    const { id, email } = await newRequest();
    expect((await req(id)).awaiting_jon_since).not.toBeNull();
    expect(await moveToStandby(id, '2027-05-13')).toEqual({ ok: true });
    expect(await req(id)).toEqual({
      status: 'standby',
      standby_week: '2027-05-10',
      awaiting_jon_since: null,
    });
    const mail = (await lastMail(email))!;
    expect(mail.subject).toBe('You’re on stand-by');
    expect(mail.text_body).toMatch(/^You’re on stand-by for the week of May 10\. If something opens up/);
    const [log] = await q<{ event_key: string }>(
      `select event_key from email_log where request_id = $1 and template = 'E6'`,
      [id],
    );
    const [audit] = await q<{ id: string; actor: string }>(
      `select id, actor from audit_log where request_id = $1 and action = 'moved_to_standby'`,
      [id],
    );
    expect(log!.event_key).toBe(audit!.id);
    expect(audit!.actor).toBe('jon');
  });

  it('works from needs_new_time; refuses stand-by, locked, a week outside the season and an unknown request', async () => {
    const { id } = await newRequest();
    await q(`update request set status = 'needs_new_time' where id = $1`, [id]);
    expect((await moveToStandby(id, '2027-05-10')).ok).toBe(true);
    expect(await moveToStandby(id, '2027-05-10')).toMatchObject({ status: 409, reason: 'not_allowed' });
    const other = await newRequest();
    expect(await moveToStandby(other.id, '2027-08-02')).toMatchObject({
      status: 409,
      reason: 'out_of_season',
    });
    expect(await moveToStandby(randomUUID(), '2027-05-10')).toMatchObject({ status: 404 });
    // pr49-review M-2 (C3 rule 12): a season week that has ended is refused, with no E6 and no audit row.
    const late = await newRequest();
    expect(await moveToStandby(late.id, '2027-04-07', new Date('2027-04-12T18:00:00Z'))).toMatchObject({
      status: 409,
      reason: 'in_the_past',
    });
    expect((await req(late.id)).status).toBe('requested');
    expect(
      await q(`select 1 from email_log where request_id = $1 and template = 'E6'`, [late.id]),
    ).toHaveLength(0);
    expect(
      await q(`select 1 from audit_log where request_id = $1 and action = 'moved_to_standby'`, [late.id]),
    ).toHaveLength(0);
    // Its Friday is still today: allowed.
    expect((await moveToStandby(late.id, '2027-04-07', new Date('2027-04-09T20:00:00Z'))).ok).toBe(true);
    const locked = await newRequest();
    const slot = await slotId('2027-04-01');
    expect(
      (await lockRequest({ requestId: locked.id, target: { slotId: slot }, mode: 'lock', now: NOW })).ok,
    ).toBe(true);
    expect(await moveToStandby(locked.id, '2027-05-10')).toMatchObject({
      status: 409,
      reason: 'not_allowed',
    });
  });

  it('the admin route: strict body, a date', async () => {
    const { id } = await newRequest();
    expect(
      (await standbyRoute(post(`/api/admin/requests/${id}/standby`, { week: 'May 10' }), ctx(id))).status,
    ).toBe(400);
    expect(
      (await standbyRoute(post(`/api/admin/requests/${id}/standby`, { week: '2027-05-10', x: 1 }), ctx(id)))
        .status,
    ).toBe(400);
    const ok = await standbyRoute(post(`/api/admin/requests/${id}/standby`, { week: '2027-05-10' }), ctx(id));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, offerId: null });
  });
});

describe('T2.4.04 Offer a freed window to one stand-by guest → E7', () => {
  it('a 48-hour standby_open offer; E7 says the real weekday and carries a take link; the guest can take it', async () => {
    const slot = await slotId('2027-05-06');
    const { id, email } = await standbyGuest();
    const res = await offerStandbyWindow(id, { slotId: slot }, false, NOW);
    expect(res).toMatchObject({ ok: true });
    const offerId = (res as { offerId: string }).offerId;
    const [o] = await q<{ kind: string; slot_ids: string[]; expires_at: Date }>(
      `select kind, slot_ids, expires_at from offer where id = $1`,
      [offerId],
    );
    expect(o).toEqual({ kind: 'standby_open', slot_ids: [slot], expires_at: new Date(NOW.getTime() + H48) });
    const r = await req(id);
    expect(r.status).toBe('standby');
    expect(r.awaiting_jon_since).toBeNull();
    const mail = (await lastMail(email))!;
    expect(mail.subject).toBe('Thursday just opened up');
    expect(mail.text_body).toMatch(/^Thu May 6 · [^\n]+ is free now\. Want it\?\n/);
    const token = tokenIn(mail.text_body)!;
    const [t] = await q<{ expires_at: Date }>(`select expires_at from action_token where offer_id = $1`, [
      offerId,
    ]);
    expect(t!.expires_at).toEqual(new Date(NOW.getTime() + H48)); // the link dies with the offer
    // pr49-review H-1: E7's link is deterministic per email row: a retry renders the same URL, one token row.
    const [log] = await q<{ id: string }>(
      `select id from email_log where request_id = $1 and template = 'E7'`,
      [id],
    );
    const again = await resolveLinkVars(log!.id, { takeLink: takeLink(offerId) });
    expect(await resolveLinkVars(log!.id, { takeLink: takeLink(offerId) })).toEqual(again);
    expect(tokenIn(String(again.takeLink))).toBe(token);
    expect(await q(`select 1 from action_token where email_log_id = $1`, [log!.id])).toHaveLength(1);
    const took = await takeRoute(post('/api/offer/take', { token, slotId: slot }));
    expect(took.status).toBe(200);
    expect((await req(id)).status).toBe('locked');
    // pr49-review L-3: a retry after the offer was taken fails closed (never a dead link).
    await expect(resolveLinkVars(log!.id, { takeLink: takeLink(offerId) })).rejects.toBeInstanceOf(
      OfferLinkGoneError,
    );
    // N49-1: a retry of that E7 is a TERMINAL render failure: attempts maxed, never retried, not resendable.
    await q(
      `update email_log set status = 'failed', attempts = 1, last_error = 'MailerHttpError', next_attempt_at = $2
        where id = $1`,
      [log!.id, new Date(NOW.getTime() - 60e3)],
    );
    expect(await deliverEmail(log!.id, { inline: false, now: NOW })).toBe('failed');
    const [failed] = await q<{ attempts: number; last_error: string }>(
      `select attempts, last_error from email_log where id = $1`,
      [log!.id],
    );
    expect(failed).toEqual({ attempts: MAX_ATTEMPTS, last_error: 'UnknownLinkKindError' });
    expect((await failedEmails(500)).find((f) => f.id === log!.id)).toMatchObject({ resendable: false });
    expect(await deliverEmail(log!.id, { inline: false, now: new Date(NOW.getTime() + 86400e3) })).toBe(
      'skipped',
    );
    // pr49-review M-3: 49 hours later the expiry leaves a TAKEN offer alone.
    await runTick(new Date(NOW.getTime() + 49 * 3600e3));
    const [after] = await q<{ released_at: Date | null; taken_at: Date | null }>(
      `select released_at, taken_at from offer where id = $1`,
      [offerId],
    );
    expect(after!.released_at).toBeNull();
    expect(after!.taken_at).not.toBeNull();
    expect(await req(id)).toMatchObject({ status: 'locked', awaiting_jon_since: null });
  });

  it('pr49-review L-2: one live stand-by offer per guest; a second window is refused while it lives', async () => {
    const first = await slotId('2027-04-15');
    const second = await slotId('2027-04-22');
    const { id } = await standbyGuest();
    expect((await offerStandbyWindow(id, { slotId: first }, false, NOW)).ok).toBe(true);
    expect(await offerStandbyWindow(id, { slotId: second }, false, NOW)).toMatchObject({
      status: 409,
      reason: 'offer_live',
    });
    expect(await q(`select 1 from offer where request_id = $1`, [id])).toHaveLength(1);
    // Once it has expired, Jon can offer another.
    const later = new Date(NOW.getTime() + H48 + 60_000);
    expect((await offerStandbyWindow(id, { slotId: second }, false, later)).ok).toBe(true);
    // The expiry then releases only the expired one; the new offer lives on.
    await expireStandbyOffers(later);
    expect(
      await q<{ s: string[]; released: boolean }>(
        `select slot_ids::text[] as s, released_at is not null as released from offer where request_id = $1
          order by created_at`,
        [id],
      ),
    ).toEqual([
      { s: [first], released: true },
      { s: [second], released: false },
    ]);
  });

  it('the engine hides the offered window from everyone but that guest', async () => {
    const slot = await slotId('2027-05-07');
    const { id, email } = await standbyGuest();
    expect((await offerStandbyWindow(id, { slotId: slot }, false, NOW)).ok).toBe(true);
    expect((await lastMail(email))!.subject).toBe('Friday just opened up');
    const loaded = await loadEngineData(NOW);
    const open = (viewer?: string) =>
      openWindows(engineInput(loaded, null, 'general', ['lunch', 'evening'], viewer)).weeks.flatMap((w) =>
        w.windows.map((x) => x.slotId),
      );
    expect(open()).not.toContain(slot);
    expect(open(id)).toContain(slot);
  });

  it('L13: a window that does not fit the dish is refused unless Jon overrides', async () => {
    const lunch = await slotId('2027-05-14');
    const { id } = await standbyGuest('the-first-round'); // evenings only
    expect(await offerStandbyWindow(id, { slotId: lunch }, false, NOW)).toMatchObject({
      status: 409,
      reason: 'not_for_this_dish',
    });
    expect(await q(`select 1 from offer where request_id = $1`, [id])).toHaveLength(0);
    expect((await offerStandbyWindow(id, { slotId: lunch }, true, NOW)).ok).toBe(true);
    const [a] = await q<{ detail: { override?: string[] } }>(
      `select detail from audit_log where request_id = $1 and action = 'standby_offered'`,
      [id],
    );
    expect(a!.detail.override).toEqual(['dish']);
    // A dates-mode range goes only to a dates-mode dish.
    const startsAt = vancouverInstant('2027-05-15', '19:30');
    const range = { startsAt, endsAt: new Date(startsAt.getTime() + 3.5 * 3600e3), where: null };
    const evenings = await standbyGuest('the-first-round');
    expect(await offerStandbyWindow(evenings.id, range, false, NOW)).toMatchObject({
      reason: 'not_for_this_dish',
    });
    const encore = await standbyGuest('the-encore');
    expect((await offerStandbyWindow(encore.id, range, false, NOW)).ok).toBe(true);
  });

  it('decision 43(4): a Something New stand-by is not offered a second Something New in one week', async () => {
    // Weeks Mon Jun 7 and Mon Jun 14 (no other test in this file uses them).
    const evening = (date: string) => ({
      startsAt: vancouverInstant(date, '19:00'),
      endsAt: vancouverInstant(date, '22:00'),
      where: null,
    });
    const booked = await newRequest({ dish: 'something-new' });
    expect(
      await lockRequest({ requestId: booked.id, target: evening('2027-06-08'), mode: 'lock' }),
    ).toMatchObject({
      ok: true,
    });
    const waiting = await standbyGuest('something-new');
    expect(await offerStandbyWindow(waiting.id, evening('2027-06-12'), false, NOW)).toMatchObject({
      status: 409,
      reason: 'week_full',
    });
    expect(await q(`select 1 from offer where request_id = $1`, [waiting.id])).toHaveLength(0);
    expect((await offerStandbyWindow(waiting.id, evening('2027-06-15'), false, NOW)).ok).toBe(true);
    // The guest's offer page shows only times a take would pass (stillOpen runs the same canLock).
    const shown = await stillOpen(
      waiting.id,
      ['2027-06-12', '2027-06-15'].map((d) => ({ slotId: null, ...evening(d) })),
      NOW,
    );
    expect(shown.map((w) => w.startsAt)).toEqual([evening('2027-06-15').startsAt]);
  });

  it('AC2: two stand-by guests can not hold a live offer on the same window, even at the same moment', async () => {
    const slot = await slotId('2027-06-25');
    const a = await standbyGuest();
    const b = await standbyGuest();
    const both = await Promise.all([
      offerStandbyWindow(a.id, { slotId: slot }, false, NOW),
      offerStandbyWindow(b.id, { slotId: slot }, false, NOW),
    ]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.find((r) => !r.ok)).toMatchObject({ status: 409, reason: 'held_by_offer' });
    expect(
      await q(
        `select 1 from offer where kind = 'standby_open' and $1 = any(slot_ids) and released_at is null`,
        [slot],
      ),
    ).toHaveLength(1);
  });

  it('refuses a request not on stand-by, a booked window, an unknown slot; the admin route maps the codes', async () => {
    const slot = await slotId('2027-05-20');
    const { id } = await newRequest();
    expect(await offerStandbyWindow(id, { slotId: slot }, false, NOW)).toMatchObject({
      reason: 'not_allowed',
    });
    const holder = await newRequest();
    expect(
      (await lockRequest({ requestId: holder.id, target: { slotId: slot }, mode: 'lock', now: NOW })).ok,
    ).toBe(true);
    const sb = await standbyGuest();
    expect(await offerStandbyWindow(sb.id, { slotId: slot }, false, NOW)).toMatchObject({
      reason: 'time_taken',
    });
    const route = await standbyOfferRoute(
      post(`/api/admin/requests/${sb.id}/standby-offer`, { slotId: slot }),
      ctx(sb.id),
    );
    expect(route.status).toBe(409);
    expect(await route.json()).toMatchObject({ code: 'time_taken' });
    const unknown = await standbyOfferRoute(
      post(`/api/admin/requests/${sb.id}/standby-offer`, { slotId: randomUUID() }),
      ctx(sb.id),
    );
    expect(unknown.status).toBe(404);
    const ranged = await standbyOfferRoute(
      post(`/api/admin/requests/${sb.id}/standby-offer`, {
        date: '2027-05-22',
        start: '19:30',
        lengthMinutes: 210,
        where: null,
        override: true,
      }),
      ctx(sb.id),
    );
    expect(ranged.status).toBe(200);
  });

  it('weekdayName is the Vancouver weekday, not UTC', () => {
    // Thu 17:00 Vancouver = Fri 00:00 UTC.
    expect(weekdayName(vancouverInstant('2027-05-13', '17:00'))).toBe('Thursday');
  });
});

describe('T2.4.09 the 48-hour expiry (AC3)', () => {
  it('AC3: an expired stand-by offer frees the window and the request appears in Needs a reply', async () => {
    const slot = await slotId('2027-05-21');
    const { id, email } = await standbyGuest();
    expect((await offerStandbyWindow(id, { slotId: slot }, false, NOW)).ok).toBe(true);
    const token = tokenIn((await lastMail(email))!.text_body)!;
    // Made 48 hours ago (its E7 went out then: a link to a dead offer is never sent, pr49-review L-3).
    await q(`update offer set expires_at = $2 where request_id = $1`, [id, new Date(NOW.getTime() - 60_000)]);
    const fresh = await standbyGuest();
    const freshSlot = await slotId('2027-05-28');
    expect((await offerStandbyWindow(fresh.id, { slotId: freshSlot }, false, NOW)).ok).toBe(true);
    const logged = async () => (await q(`select 1 from email_log where request_id = $1`, [id])).length;
    const mails = await logged();

    const tick = await runTick(NOW);
    expect(tick.ran).toContain('offer-expiry');
    const offers = await q<{ id: string; request_id: string; released_at: Date | null }>(
      `select id, request_id, released_at from offer where request_id = any($1::uuid[])`,
      [[id, fresh.id]],
    );
    expect(offers.find((o) => o.request_id === id)!.released_at).toEqual(NOW);
    expect(offers.find((o) => o.request_id === fresh.id)!.released_at).toBeNull(); // not yet 48 h
    expect((await req(id)).awaiting_jon_since).toEqual(NOW); // Needs a reply
    expect((await req(fresh.id)).awaiting_jon_since).toBeNull();
    expect(await logged()).toBe(mails); // no email
    // The window is free again: another stand-by guest can be offered it.
    const next = await standbyGuest();
    expect((await offerStandbyWindow(next.id, { slotId: slot }, false, NOW)).ok).toBe(true);
    // The old link now answers with the state, not a lock.
    const late = await takeRoute(post('/api/offer/take', { token, slotId: slot }));
    expect(late.status).toBe(200);
    expect(await late.json()).toMatchObject({ status: 'standby', message: ERRORS.offerGone });
    const [t] = await q<{ used_at: Date | null }>(`select used_at from action_token where offer_id = $1`, [
      offers.find((o) => o.request_id === id)!.id,
    ]);
    expect(t!.used_at).toEqual(NOW);
    expect((await req(id)).status).toBe('standby');
    // A second run finds nothing.
    expect(await expireStandbyOffers(NOW)).toBe(0);
  });

  it('pr49-review M-1: a request another transaction holds is skipped (no deadlock, no error), then expired', async () => {
    const { id } = await standbyGuest();
    const old = new Date(NOW.getTime() - H48 - 60_000);
    const [o] = await q<{ id: string }>(
      `insert into offer (request_id, kind, slot_ids, expires_at) values ($1, 'standby_open', '{}', $2) returning id`,
      [id, old],
    );
    const holder = await pool().connect();
    try {
      await holder.query('begin');
      await holder.query(`select id from request where id = $1 for update`, [id]); // a take or cancel mid-tx
      await expireStandbyOffers(NOW);
      const [mid] = await q<{ released_at: Date | null }>(`select released_at from offer where id = $1`, [
        o!.id,
      ]);
      expect(mid!.released_at).toBeNull(); // skipped: the next tick gets it
      await holder.query('commit');
    } finally {
      holder.release();
    }
    await expireStandbyOffers(NOW);
    const [done] = await q<{ released_at: Date | null }>(`select released_at from offer where id = $1`, [
      o!.id,
    ]);
    expect(done!.released_at).toEqual(NOW);
  });

  it('pr49-review L-1: the tick job works in batches until none are left or its budget is spent', async () => {
    const guests = [await standbyGuest(), await standbyGuest(), await standbyGuest()];
    const old = new Date(NOW.getTime() - H48 - 60_000);
    for (const g of guests) {
      await q(
        `insert into offer (request_id, kind, slot_ids, expires_at) values ($1, 'standby_open', '{}', $2)`,
        [g.id, old],
      );
    }
    const live = async () =>
      (
        await q(`select 1 from offer where request_id = any($1::uuid[]) and released_at is null`, [
          guests.map((g) => g.id),
        ])
      ).length;
    await expireStandbyOffers(NOW); // earlier leftovers of this DB too
    expect(await live()).toBe(0);
    for (const g of guests) {
      await q(`update offer set released_at = null where request_id = $1`, [g.id]);
    }
    expect(await expireAllStandbyOffers(NOW, Date.now() - 1, 1)).toBe(1); // budget spent after one batch
    expect(await live()).toBe(2);
    expect(await expireAllStandbyOffers(NOW, Date.now() + 60_000, 1)).toBe(2);
    expect(await live()).toBe(0);
  });

  it('an earlier wait keeps its start; a request that has moved on is not flagged', async () => {
    const a = await standbyGuest();
    const b = await standbyGuest();
    const old = new Date(NOW.getTime() - H48 - 60_000);
    await q(
      `insert into offer (request_id, kind, slot_ids, expires_at) values ($1, 'standby_open', '{}', $2), ($3, 'standby_open', '{}', $2)`,
      [a.id, old, b.id],
    );
    const earlier = new Date(NOW.getTime() - 5 * 24 * 3600e3);
    await q(`update request set awaiting_jon_since = $2 where id = $1`, [a.id, earlier]);
    await q(`update request set status = 'cancelled', awaiting_jon_since = null where id = $1`, [b.id]);
    expect(await expireStandbyOffers(NOW)).toBeGreaterThanOrEqual(2);
    expect((await req(a.id)).awaiting_jon_since).toEqual(earlier);
    expect((await req(b.id)).awaiting_jon_since).toBeNull();
  });
});
