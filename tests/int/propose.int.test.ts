// T2.4.08 (lane L1): the guest proposes new times or dates from S18 (an offer that doesn't suit, or a weather
// call): the same row goes back to `requested` with its choices replaced, the live offers go, E16 goes to Jon and
// the request is in Needs a reply. The single-use link is spent once; a refusal leaves it usable.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

import { ERRORS } from '@/content';
import { POST as proposeRoute } from '@/app/api/offer/propose/route';
import { findToken, issueToken } from '@/features/invites/action-tokens';
import { loadNewDateModel, loadOfferModel } from '@/features/invites/manage-model';
import { createRequestTx } from '@/features/requests/create';
import { lockRequest } from '@/features/requests/lock';
import { VALIDATION_MESSAGE } from '@/features/requests/messages';
import { createOffer, releaseLiveOffers } from '@/features/requests/offers';
import { PROPOSE_ACTION, proposeTimes } from '@/features/requests/propose';
import { RequestBody } from '@/features/requests/schema';
import { suggestTimes } from '@/features/requests/suggest';
import { pool, q, withTx } from '@/lib/db';
import { saveEmailBudget } from '../fixtures/email-budget';
import { removeRequests } from '../fixtures/requests-db';

const SITE = 'http://localhost:3000';
const NOW = new Date('2027-03-15T18:00:00Z');
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

/** Lunch slots nothing locked or finished overlaps (other files' bookings stay on a re-run of the same DB). */
async function freeLunches(n: number): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `select s.id from slot s
      where s.window_kind = 'lunch' and s.date >= '2027-04-01'
        and not exists (select 1 from request r where r.status in ('locked', 'done')
                          and tstzrange(r.locked_starts_at, r.locked_ends_at) && tstzrange(s.starts_at, s.ends_at))
      order by s.starts_at desc limit $1`,
    [n],
  );
  return rows.map((r) => r.id);
}

async function newRequest(slotIds: string[] = []) {
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name: 'Robin Guest',
    email: `robin+${randomUUID().slice(0, 8)}@example.com`,
    crew: 2,
    slotIds,
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
      bigCrew: false,
      dishName: 'The Long Lunch',
    }),
  );
  made.push(requestId);
  return { id: requestId, email: body.email };
}

const row = async (id: string) =>
  (
    await q<{ status: string; awaiting_jon_since: Date | null; spam_suspect: boolean }>(
      `select status, awaiting_jon_since, spam_suspect from request where id = $1`,
      [id],
    )
  )[0]!;
const choices = async (id: string) =>
  (await q<{ slot_id: string }>(`select slot_id from request_slot_choice where request_id = $1`, [id])).map(
    (r) => r.slot_id,
  );
const e16 = async (id: string) =>
  q<{ event_key: string }>(`select event_key from email_log where request_id = $1 and template = 'E16'`, [
    id,
  ]);
const liveOffers = async (id: string) =>
  q(`select 1 from offer where request_id = $1 and released_at is null and taken_at is null`, [id]);
const post = (body: unknown, origin = SITE) =>
  new NextRequest(`${SITE}/api/offer/propose`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A suggested offer and its take link, as E5 carries it. */
async function offered(id: string, slotIds: string[]) {
  const res = await suggestTimes(id, { slotIds }, '', NOW);
  expect(res.ok).toBe(true);
  const offerId = (res as { offerId: string }).offerId;
  const token = await withTx((c) =>
    issueToken(c, {
      purpose: 'take_offer',
      requestId: id,
      offerId,
      expiresAt: new Date(NOW.getTime() + 864e5),
    }),
  );
  return { offerId, token };
}

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

describe('T2.4.08 the guest proposes new times → the same row, E16', () => {
  it('from an offer: the same row is requested again with the new choices, the offer goes, E16 to Jon', async () => {
    const [offer, mine, other] = await freeLunches(3);
    const { id } = await newRequest([mine!]);
    const { offerId, token } = await offered(id, [offer!]);
    const clientKey = randomUUID();
    const res = await proposeRoute(post({ token, slotIds: [other!], clientKey }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await res.json()).toEqual({ ok: true, status: 'requested' });
    expect(await row(id)).toMatchObject({ status: 'requested', awaiting_jon_since: NOW }); // Needs a reply
    expect(await choices(id)).toEqual([other]);
    expect(await liveOffers(id)).toHaveLength(0);
    expect((await findToken(token))!.used_at).not.toBeNull();
    expect(await e16(id)).toEqual([{ event_key: clientKey }]);
    const [a] = await q<{ actor: string; detail: Record<string, unknown> }>(
      `select actor, detail from audit_log where request_id = $1 and action = $2`,
      [id, PROPOSE_ACTION],
    );
    expect(a).toEqual({
      actor: 'guest',
      detail: { from_status: 'needs_new_time', to_status: 'requested', client_key: clientKey },
    });
    expect(await q(`select 1 from offer where id = $1 and released_at is not null`, [offerId])).toHaveLength(
      1,
    );
    // Proposing twice acts once: the spent link answers with the state, no second E16.
    const again = await proposeRoute(post({ token, slotIds: [other!], clientKey }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, status: 'requested' });
    expect(await e16(id)).toHaveLength(1);
  });

  it('from a weather call: the pick_new_date link proposes new dates for the same row', async () => {
    const [mine, next] = await freeLunches(2);
    const { id } = await newRequest([mine!]);
    await q(`update request set status = 'needs_new_time' where id = $1`, [id]);
    const offerId = await withTx((c) => createOffer(c, { requestId: id, kind: 'weather_call' }));
    const token = await withTx((c) =>
      issueToken(c, {
        purpose: 'pick_new_date',
        requestId: id,
        offerId,
        expiresAt: new Date(NOW.getTime() + 864e5),
      }),
    );
    const res = await proposeRoute(post({ token, slotIds: [next!], clientKey: randomUUID() }));
    expect(res.status).toBe(200);
    expect(await row(id)).toMatchObject({ status: 'requested', awaiting_jon_since: NOW });
    expect(await choices(id)).toEqual([next]);
    expect(await e16(id)).toHaveLength(1);
    // The spent weather-call link now shows the state from its own page model.
    const later = await proposeRoute(post({ token, slotIds: [next!], clientKey: randomUUID() }));
    expect(later.status).toBe(200);
    expect(await e16(id)).toHaveLength(1);
    // QA r2 M1: that state is "Sent" (the page lists what was sent), never "Looks like that one went".
    expect(await later.json()).toEqual({ ok: true, status: 'requested', message: null });
    expect(await loadNewDateModel(token)).toMatchObject({
      kind: 'current',
      status: 'requested',
      message: null,
    });
  });

  it('QA r2 M1: an offer link after its own propose shows "Sent" too; a gone offer still says so', async () => {
    const [offer, next] = await freeLunches(2);
    const { id } = await newRequest();
    const { token } = await offered(id, [offer!]);
    expect((await proposeRoute(post({ token, slotIds: [next!], clientKey: randomUUID() }))).status).toBe(200);
    expect(await loadOfferModel(token)).toMatchObject({
      kind: 'current',
      status: 'requested',
      message: null,
    });

    const other = await newRequest();
    const gone = await offered(other.id, [offer!]);
    await q(`update offer set released_at = now() where id = $1`, [gone.offerId]);
    expect(await loadOfferModel(gone.token)).toMatchObject({
      kind: 'current',
      status: 'needs_new_time',
      message: ERRORS.offerGone,
    });
  });

  it('a refused choice changes nothing and leaves the link usable', async () => {
    const [offer, taken, open] = await freeLunches(3);
    const { id } = await newRequest();
    const { token } = await offered(id, [offer!]);
    const rival = await newRequest([taken!]);
    expect(
      (await lockRequest({ requestId: rival.id, target: { slotId: taken! }, mode: 'lock', now: NOW })).ok,
    ).toBe(true);
    const gone = await proposeRoute(post({ token, slotIds: [taken!], clientKey: randomUUID() }));
    expect(gone.status).toBe(409);
    expect(await gone.json()).toMatchObject({ code: 'time_gone', message: VALIDATION_MESSAGE.time_gone });
    expect(await row(id)).toMatchObject({ status: 'needs_new_time' });
    expect((await findToken(token))!.used_at).toBeNull();
    expect(await liveOffers(id)).toHaveLength(1);
    expect(await e16(id)).toHaveLength(0);
    // A request that moved on (cancelled after the check, before the transaction) is refused inside it: rolled back.
    await q(`update request set status = 'cancelled' where id = $1`, [id]);
    await q(`update offer set released_at = null where request_id = $1`, [id]);
    expect(
      await proposeTimes({ token, slotIds: [open!], dates: [], overnight: false, clientKey: randomUUID() }),
    ).toEqual({
      ok: false,
      status: 409,
      reason: 'not_changeable',
    });
    expect((await findToken(token))!.used_at).toBeNull(); // un-spent with the rollback
    expect(await e16(id)).toHaveLength(0);
  });

  it('guards: Origin, a strict body, a tampered, a manage or an expired token; a honeypot is kept, not refused', async () => {
    const [offer, next] = await freeLunches(2);
    const { id } = await newRequest();
    const { token, offerId } = await offered(id, [offer!]);
    const body = { token, slotIds: [next!], clientKey: randomUUID() };
    expect((await proposeRoute(post(body, 'https://evil.example'))).status).toBe(403);
    expect((await proposeRoute(post({ ...body, requestId: id }))).status).toBe(400);
    expect((await proposeRoute(post({ ...body, token: 'x'.repeat(43) }))).status).toBe(404);
    const manage = await withTx((c) =>
      issueToken(c, { purpose: 'manage', requestId: id, expiresAt: new Date(NOW.getTime() + 864e5) }),
    );
    expect((await proposeRoute(post({ ...body, token: manage }))).status).toBe(400);
    await q(`update action_token set expires_at = $2 where offer_id = $1`, [
      offerId,
      new Date('2026-01-01T00:00:00Z'),
    ]);
    const stale = await proposeRoute(post({ ...body, slotIds: [randomUUID()] })); // F3: a bad choice too
    expect(stale.status).toBe(410);
    expect(await stale.json()).toMatchObject({ message: ERRORS.stale });
    expect(await row(id)).toMatchObject({ status: 'needs_new_time' });
    await q(`update action_token set expires_at = $2 where offer_id = $1`, [
      offerId,
      new Date(NOW.getTime() + 864e5),
    ]);
    // AD-9: the same answer, but a spam suspect: no E16, not in Needs a reply.
    const hp = await proposeRoute(post({ ...body, hp: 'bot text' }));
    expect(hp.status).toBe(200);
    expect(await row(id)).toMatchObject({
      status: 'requested',
      spam_suspect: true,
      awaiting_jon_since: null,
    });
    expect(await e16(id)).toHaveLength(0);
  });

  it('racing a guest cancel: the propose waits on the request row (request -> token), no deadlock', async () => {
    const [offer, next] = await freeLunches(2);
    const { id } = await newRequest();
    const { token } = await offered(id, [offer!]);
    const b = { token, slotIds: [next!], dates: [], overnight: false, clientKey: randomUUID() };
    expect(await heldCancel(id, () => proposeTimes(b))).toBe('spent');
    expect(await e16(id)).toHaveLength(0);
  });

  it('pr56-review F1: a live link on a LOCKED booking never unlocks it (only its manage page can)', async () => {
    const [offer, next] = await freeLunches(2);
    const { id } = await newRequest([offer!]);
    const { token, offerId } = await offered(id, [offer!]);
    expect(
      (await lockRequest({ requestId: id, target: { slotId: offer! }, mode: 'lock', now: NOW })).ok,
    ).toBe(true);
    // A path to locked that leaves the link live (T2.10 join and friends): revive it.
    await q(`update action_token set used_at = null where offer_id = $1`, [offerId]);
    await q(`update offer set released_at = null where id = $1`, [offerId]);
    const res = await proposeRoute(post({ token, slotIds: [next!], clientKey: randomUUID() }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'not_changeable' });
    expect(await row(id)).toMatchObject({ status: 'locked' });
    expect(
      await q(`select 1 from outbox where request_id = $1 and kind = 'calendar_delete'`, [id]),
    ).toHaveLength(0);
    expect((await findToken(token))!.used_at).toBeNull(); // rolled back
    expect(await e16(id)).toHaveLength(0);
  });

  it('pr56-review F2: the same submit twice (a retry or a double tap) gets the same success, one E16', async () => {
    const [offer, next] = await freeLunches(2);
    const { id } = await newRequest();
    const { token } = await offered(id, [offer!]);
    const body = { token, slotIds: [next!], clientKey: randomUUID() };
    const both = await Promise.all([proposeRoute(post(body)), proposeRoute(post(body))]);
    for (const r of both) {
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, status: 'requested' });
    }
    const retry = await proposeRoute(post(body));
    expect(await retry.json()).toEqual({ ok: true, status: 'requested' });
    expect(await e16(id)).toHaveLength(1);
  });

  it('pr56-review F4: the offerTake limit answers 429 first, before any token or row work', async () => {
    const { id } = await newRequest();
    const body = { token: 'x'.repeat(43), slotIds: [], clientKey: randomUUID() };
    for (let i = 0; i < 10; i++) expect((await proposeRoute(post(body))).status).toBe(404);
    const limited = await proposeRoute(post({ ...body, token: 'y'.repeat(43) }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('cache-control')).toBe('no-store');
    expect(await e16(id)).toHaveLength(0);
  });
});
