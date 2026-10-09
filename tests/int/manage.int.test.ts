// T2.7.08: action tokens (T2.7.01), the manage grant (T2.7.02), the read-only loaders (T2.7.03), guest cancel
// (T2.7.04, E11 + E12), Ask for another time (T2.7.05, E16), Add a story through the manage grant (T2.7.06), and
// TSD T2.7 AC1–AC6 plus the §6 "Joined requests" rules 2, 4 and 5, against the test DB with the mock calendar.
// The clock is 2027-03-15 (after the general release, before the season); each test uses its own season days.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  }),
}));

import { ALREADY, CLOSED_IN_PERSON_LABEL, ERRORS, GUEST_LABEL, JON_CANCELLED_LABEL } from '@/content';
import { GET as availability } from '@/app/api/availability/route';
import { POST as cancelRoute } from '@/app/api/manage/cancel/route';
import { POST as anotherTimeRoute } from '@/app/api/manage/another-time/route';
import { POST as photoSign } from '@/app/api/photos/sign/route';
import { POST as storyRoute } from '@/app/api/stories/route';
import { openWindows } from '@/features/availability/openWindows';
import { engineInput, loadEngineData } from '@/features/availability/load';
import { REQ_COOKIE } from '@/features/invites/capability';
import { INVITE_COOKIE } from '@/features/invites/session';
import {
  consumeToken,
  findToken,
  issueManageToken,
  issueToken,
  manageExpiry,
  manageGrant,
  MANAGE_HEADER,
} from '@/features/invites/action-tokens';
import { loadManageModel, loadNewDateModel, loadOfferModel } from '@/features/invites/manage-model';
import { signCookie } from '@/features/invites/tokens';
import { createRequestTx } from '@/features/requests/create';
import { cancelByGuest, cancelForGuest } from '@/features/requests/guest-cancel';
import { lockRequest } from '@/features/requests/lock';
import { rerequest } from '@/features/requests/rerequest';
import { RequestBody } from '@/features/requests/schema';
import { mockCalendar } from '@/lib/adapters/mock/calendar';
import { pool, q, withTx } from '@/lib/db';
import { removeRequests } from '../fixtures/requests-db';

const SITE = 'http://localhost:3000';
const NOW = new Date('2027-03-15T18:00:00Z');
const made: string[] = [];
let generalId = '';
let rotatedId = '';

/** Every season day this file books (pr32-review L2: a re-run on the same DB starts from a clean slate). */
const DAYS = [
  '2027-04-01',
  '2027-04-02',
  '2027-04-16',
  '2027-05-06',
  '2027-05-07',
  '2027-05-13',
  '2027-05-14',
  '2027-05-20',
  '2027-05-21',
  '2027-06-03',
  '2027-06-04',
  '2027-06-10',
  '2027-06-11',
  '2027-06-24',
  '2027-06-25',
];
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  // Leftovers from an earlier run, or another file's bookings on these days (e.g. a far-future tick's 'done').
  await q(
    `update request set status = 'cancelled', cancelled_at = now()
      where status in ('locked', 'done', 'standby') and (locked_starts_at at time zone 'America/Vancouver')::date = any($1::date[])`,
    [DAYS],
  );
  await q(`update request set status = 'cancelled' where status = 'standby' and standby_week = '2027-06-21'`);
  await q(`delete from invite where token_secret = 'z9z9z9z9'`);
  await q(`update invite set revoked_at = null
            where id = (select id from invite where kind = 'general' order by created_at limit 1)
              and not exists (select 1 from invite where kind = 'general' and revoked_at is null)`);
  await q(`delete from rate_limit where scope = 'manageAction'`);
  generalId = (
    await q<{ id: string }>(`select id from invite where kind = 'general' and revoked_at is null`)
  )[0]!.id;
});
beforeEach(() => {
  jar.clear();
  vi.restoreAllMocks();
});
afterAll(async () => {
  vi.useRealTimers();
  await removeRequests(made);
  if (rotatedId) {
    await q(`delete from invite where id = $1`, [rotatedId]);
    await q(`update invite set revoked_at = null where id = $1`, [generalId]);
  }
  await pool().end();
});

const slotId = async (date: string, w: 'lunch' | 'evening') =>
  (await q<{ id: string }>(`select id from slot where date = $1 and window_kind = $2`, [date, w]))[0]!.id;

async function newRequest(slotIds: string[], dish = 'the-long-lunch') {
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish,
    name: 'Dave Guest',
    email: `dave+${randomUUID().slice(0, 8)}@example.com`,
    crew: 2,
    slotIds,
    surpriseNeedToKnow: dish === 'surprise-me' ? 'No cilantro' : undefined,
    surprisePlan: dish === 'surprise-me' ? 'CANARY-OWN-PLAN' : undefined,
  });
  const { requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId: generalId,
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
  return requestId;
}
async function lockedRequest(date: string, w: 'lunch' | 'evening' = 'lunch') {
  const slot = await slotId(date, w);
  const id = await newRequest([slot]);
  const res = await lockRequest({ requestId: id, target: { slotId: slot }, mode: 'lock', now: NOW });
  expect(res.ok).toBe(true);
  return { id, slot };
}
/** A second guest joined to a locked host (T2.10 builds the admin action; the row shape is §6's). */
async function joinTo(hostId: string) {
  const id = await newRequest([]);
  await q(
    `update request set status = 'locked', joined_to_request_id = $2, counts_toward = 'none' where id = $1`,
    [id, hostId],
  );
  return id;
}
const manageToken = (requestId: string) => withTx((c) => issueManageToken(c, requestId, NOW));
const row = async (id: string) =>
  (
    await q<{
      status: string;
      joined_to_request_id: string | null;
      google_event_id: string | null;
      calendar_state: string;
      awaiting_jon_since: Date | null;
      cancelled_by: string | null;
      locked_starts_at: Date | null;
    }>(
      `select status, joined_to_request_id, google_event_id, calendar_state, awaiting_jon_since, cancelled_by,
              locked_starts_at from request where id = $1`,
      [id],
    )
  )[0]!;
const templates = async (id: string) =>
  (
    await q<{ template: string }>(
      `select template from email_log where request_id = $1 and template not in ('E1', 'E2') order by template`,
      [id],
    )
  ).map((e) => e.template);
const post = (url: string, token: string | null, body: unknown = {}) =>
  new NextRequest(`${SITE}${url}`, {
    method: 'POST',
    headers: {
      origin: SITE,
      'content-type': 'application/json',
      ...(token ? { [MANAGE_HEADER]: token } : {}),
    },
    body: JSON.stringify(body),
  });
const isOpen = async (slot: string) => {
  const loaded = await loadEngineData(NOW);
  const out = openWindows(engineInput(loaded, [], 'general', ['lunch', 'evening']));
  return out.weeks.some((w) => w.windows.some((x) => x.slotId === slot));
};
/** md5 of every table a token page could touch (T2.7.08: before and after must be equal). */
const snapshot = async () =>
  (
    await q<{ h: string }>(
      `select ${[
        'request',
        'offer',
        'action_token',
        'email_log',
        'outbox',
        'audit_log',
        'story',
        'invite',
        'rate_limit',
      ]
        .map((t) => `(select md5(coalesce(string_agg(t::text, '' order by t::text), '')) from ${t} t)`)
        .join(' || ')} as h`,
    )
  )[0]!.h;

describe('action tokens (T2.7.01)', () => {
  it('stores only the SHA-256; the raw token finds its row; malformed or unknown tokens find nothing', async () => {
    const id = await newRequest([]);
    const raw = await manageToken(id);
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await q<{ token_hash: Buffer }>(
      `select token_hash from action_token where request_id = $1`,
      [id],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.token_hash.toString('base64url')).not.toBe(raw);
    expect(await findToken(raw)).toMatchObject({ purpose: 'manage', request_id: id, used_at: null });
    expect(await findToken(randomBytes(32).toString('base64url'))).toBeNull();
    expect(await findToken(`${raw}x`)).toBeNull();
    expect(await findToken(`${raw.slice(0, 42)}'`)).toBeNull();
    expect(await findToken(null)).toBeNull();
  });

  it('a manage token lasts to the booking end + 7 days once locked, else 120 days from issue', async () => {
    const { id } = await lockedRequest('2027-05-06');
    const end = (await q<{ e: Date }>(`select locked_ends_at as e from request where id = $1`, [id]))[0]!.e;
    const locked = await findToken(await manageToken(id));
    expect(locked!.expires_at.getTime()).toBe(end.getTime() + 7 * 86400_000);
    const open = await findToken(await manageToken(await newRequest([])));
    expect(open!.expires_at.getTime()).toBe(NOW.getTime() + 120 * 86400_000);
  });

  it('consumeToken: exactly one of two concurrent spends wins; a manage token is never spent', async () => {
    const id = await newRequest([]);
    const raw = await withTx((c) =>
      issueToken(c, { purpose: 'take_offer', requestId: id, expiresAt: new Date('2027-12-01T00:00:00Z') }),
    );
    const spent = await Promise.all([raw, raw].map((r) => withTx((c) => consumeToken(c, r))));
    expect(spent.filter(Boolean)).toHaveLength(1);
    expect(await withTx((c) => consumeToken(c, raw))).toBeNull();
    const manage = await manageToken(id);
    expect(await withTx((c) => consumeToken(c, manage))).toBeNull();
    expect((await findToken(manage))!.used_at).toBeNull();
    const expired = await withTx((c) =>
      issueToken(c, { purpose: 'take_offer', requestId: id, expiresAt: new Date('2026-01-01T00:00:00Z') }),
    );
    expect(await withTx((c) => consumeToken(c, expired))).toBeNull();
  });
});

describe('token pages: read-only loaders (T2.7.03, AC1–AC4)', () => {
  it('AC1: loading every token page, and the manage-granted picker, changes nothing in the database', async () => {
    const { id } = await lockedRequest('2027-05-07');
    const manage = await manageToken(id);
    const [offer] = await q<{ id: string }>(
      `insert into offer (request_id, kind, slot_ids, expires_at) values ($1, 'suggested_times', $2, $3) returning id`,
      [id, [await slotId('2027-05-06', 'evening')], new Date('2027-04-01T00:00:00Z')],
    );
    const take = await withTx((c) =>
      issueToken(c, {
        purpose: 'take_offer',
        requestId: id,
        offerId: offer!.id,
        expiresAt: new Date('2027-04-01T00:00:00Z'),
      }),
    );
    const pick = await withTx((c) =>
      issueToken(c, { purpose: 'pick_new_date', requestId: id, expiresAt: new Date('2027-04-01T00:00:00Z') }),
    );
    const before = await snapshot();
    // GET, HEAD and a Safe-Links-style prefetch all reach the same loaders (a page render); twice each.
    for (let i = 0; i < 3; i++) {
      await loadManageModel(manage);
      await loadOfferModel(take);
      await loadNewDateModel(pick);
      await loadManageModel(take); // a token of the wrong purpose
      await availability(
        new NextRequest(`${SITE}/api/availability?dish=the-long-lunch`, {
          headers: { [MANAGE_HEADER]: manage },
        }),
      );
    }
    expect(await snapshot()).toBe(before);
    expect((await findToken(take))!.used_at).toBeNull();
  });

  it('manage: status, when, where and the actions; a Surprise Me guest sees their own plan', async () => {
    const { id } = await lockedRequest('2027-06-03');
    expect(await loadManageModel(await manageToken(id))).toMatchObject({
      kind: 'manage',
      requestId: id,
      status: 'locked',
      label: 'Locked in',
      when: 'Thu Jun 3 · noon–2 pm Vancouver time', // QA C, EML-01: as the site writes it, whose clock
      ownPlan: null,
      canCancel: true,
      canAskAnother: true,
      canAddStory: true,
    });
    // pr32-review L1: a plan stored on a non-Surprise dish never comes back.
    const notSurprise = await newRequest([]);
    await q(`update request set surprise_plan_sealed = 'CANARY-NOT-SURPRISE' where id = $1`, [notSurprise]);
    expect(await loadManageModel(await manageToken(notSurprise))).toMatchObject({
      kind: 'manage',
      ownPlan: null,
    });
    const surprise = await newRequest([], 'surprise-me');
    expect(await loadManageModel(await manageToken(surprise))).toMatchObject({
      status: 'requested',
      label: 'Sent',
      when: null,
      ownPlan: 'CANARY-OWN-PLAN',
    });
  });

  it('manage: after the end it reads Done (lazily, no write); closed in person reads "Sorted. See you soon."', async () => {
    const { id } = await lockedRequest('2027-06-04');
    const token = await manageToken(id);
    const later = new Date('2027-06-05T12:00:00Z');
    expect(await loadManageModel(token, later)).toMatchObject({
      status: 'done',
      canCancel: false,
      canAskAnother: false,
    });
    expect((await row(id)).status).toBe('locked');
    const closed = await newRequest([]);
    await q(`update request set status = 'cancelled', closed_in_person = true where id = $1`, [closed]);
    expect(await loadManageModel(await manageToken(closed))).toMatchObject({
      status: 'cancelled',
      label: CLOSED_IN_PERSON_LABEL,
      canCancel: false,
    });
  });

  it('AC2: a spent or gone offer shows the current state; AC3: expired → the "text me" line; AC4: tampered → not found', async () => {
    const { id } = await lockedRequest('2027-06-10');
    const [offer] = await q<{ id: string }>(
      `insert into offer (request_id, kind, slot_ids) values ($1, 'suggested_times', $2) returning id`,
      [id, [await slotId('2027-06-10', 'evening')]],
    );
    const exp = new Date('2027-04-01T00:00:00Z');
    const take = await withTx((c) =>
      issueToken(c, { purpose: 'take_offer', requestId: id, offerId: offer!.id, expiresAt: exp }),
    );
    const live = await loadOfferModel(take);
    expect(live).toMatchObject({ kind: 'offer', offerKind: 'suggested_times' });
    expect(live.kind === 'offer' && live.windows).toHaveLength(1);
    await withTx((c) => consumeToken(c, take));
    const when = (await loadManageModel(await manageToken(id))) as { when: string };
    expect(await loadOfferModel(take)).toMatchObject({
      kind: 'current',
      message: ALREADY.lockedIn(when.when),
    });
    // A released offer (the guest cancelled) with an unspent token: the current state too.
    const take2 = await withTx((c) =>
      issueToken(c, { purpose: 'take_offer', requestId: id, offerId: offer!.id, expiresAt: exp }),
    );
    await q(`update offer set released_at = now() where id = $1`, [offer!.id]);
    expect(await loadOfferModel(take2)).toMatchObject({ kind: 'current' });

    const old = await withTx((c) =>
      issueToken(c, { purpose: 'manage', requestId: id, expiresAt: new Date('2027-03-01T00:00:00Z') }),
    );
    expect(await loadManageModel(old)).toEqual({ kind: 'expired', message: ERRORS.stale });
    expect(await loadOfferModel(randomBytes(32).toString('base64url'))).toEqual({ kind: 'not_found' });
    expect(await loadManageModel('not-a-token')).toEqual({ kind: 'not_found' });
    expect(await loadNewDateModel(take)).toEqual({ kind: 'not_found' }); // wrong purpose

    const pick = await withTx((c) =>
      issueToken(c, { purpose: 'pick_new_date', requestId: id, expiresAt: exp }),
    );
    expect(await loadNewDateModel(pick)).toMatchObject({ kind: 'current', status: 'locked' });
    await q(`update request set status = 'needs_new_time' where id = $1`, [id]);
    expect(await loadNewDateModel(pick)).toMatchObject({ kind: 'new_date', status: 'needs_new_time' });
    await withTx((c) => consumeToken(c, pick));
    expect(await loadNewDateModel(pick)).toMatchObject({ kind: 'current', message: ERRORS.offerGone });
    // Q7 (approved: Jon 2026-10-09): after Jon cancelled, the old link has no "Already cancelled. No guilt." line
    // (the heading "Cancelled, no problem" says it); after the guest's own cancel it keeps the line.
    await q(
      `update request set status = 'cancelled', cancelled_by = 'jon', cancelled_at = now() where id = $1`,
      [id],
    );
    expect(await loadNewDateModel(pick)).toMatchObject({
      kind: 'current',
      label: JON_CANCELLED_LABEL,
      message: '',
    });
    await q(`update request set cancelled_by = 'guest' where id = $1`, [id]);
    expect(await loadNewDateModel(pick)).toMatchObject({ kind: 'current', message: ALREADY.cancelled });
  });
});

describe('guest cancel (T2.7.04, E11 + E12, AC5)', () => {
  it('AC5: cancel frees the window at once, deletes the event, releases offers, sends E11 + E12 once', async () => {
    const remove = vi.spyOn(mockCalendar, 'remove');
    const { id, slot } = await lockedRequest('2027-06-11');
    const eventId = (await row(id)).google_event_id;
    expect(eventId).toMatch(/^mock-/);
    await q(`insert into offer (request_id, kind, slot_ids) values ($1, 'suggested_times', '{}')`, [id]);
    const take = await withTx((c) =>
      issueToken(c, { purpose: 'take_offer', requestId: id, expiresAt: new Date('2027-12-01T00:00:00Z') }),
    );
    expect(await isOpen(slot)).toBe(false);
    const token = await manageToken(id);

    const res = await cancelRoute(post('/api/manage/cancel', token));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, already: false });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer'); // pr32-review L3
    expect((await findToken(take))!.used_at).not.toBeNull(); // L4: released offers spend their single-use tokens
    expect((await findToken(token))!.used_at).toBeNull(); // ... never the manage token
    expect(await isOpen(slot)).toBe(true);
    expect(await row(id)).toMatchObject({
      status: 'cancelled',
      cancelled_by: 'guest',
      awaiting_jon_since: null,
      google_event_id: null,
      calendar_state: 'none',
    });
    expect(remove).toHaveBeenCalledWith(eventId);
    expect(await q(`select 1 from offer where request_id = $1 and released_at is null`, [id])).toHaveLength(
      0,
    );
    const e12 = await q<{ to_email: string; status: string }>(
      `select to_email::text, status from email_log where request_id = $1 and template = 'E12'`,
      [id],
    );
    expect(e12).toEqual([{ to_email: 'jon@example.com', status: 'sent' }]);
    expect(await templates(id)).toEqual(['E11', 'E12', 'E4']);

    const again = await cancelRoute(post('/api/manage/cancel', token));
    expect(await again.json()).toMatchObject({ ok: true, already: true, message: ALREADY.cancelled });
    expect(await templates(id)).toEqual(['E11', 'E12', 'E4']);
  });

  it("E12 carries the time and that week's stand-by list; an unlocked request says so", async () => {
    const { id } = await lockedRequest('2027-06-24');
    const standby = await newRequest([]);
    await q(
      `update request set status = 'standby', standby_week = '2027-06-21', contact_name = 'Sue Standby' where id = $1`,
      [standby],
    );
    await cancelByGuest(id);
    const [vars] = await q<{ vars: Record<string, string> }>(
      `select vars from email_log where request_id = $1 and template = 'E12'`,
      [id],
    );
    expect(vars!.vars).toMatchObject({ name: 'Dave Guest', dish: 'The Long Lunch', standby: 'Sue Standby' });
    expect(vars!.vars.when).toBe('Thu Jun 24 · noon–2 pm'); // T3.2 M7: the site's 12-hour style
    expect(vars!.vars.adminLink).toBe(`${SITE}/admin/requests/${id}`);

    const open = await newRequest([]);
    await cancelByGuest(open);
    const [v2] = await q<{ vars: Record<string, string> }>(
      `select vars from email_log where request_id = $1 and template = 'E12'`,
      [open],
    );
    expect(v2!.vars).toMatchObject({ when: 'no time locked yet', standby: '' }); // EML-15: no week, no stand-by line
    expect(await q(`select 1 from outbox where request_id = $1`, [open])).toHaveLength(0); // no event, no delete row
  });

  it('refuses a booking whose end has passed, a foreign Origin, and a missing or stale manage token', async () => {
    const { id } = await lockedRequest('2027-06-25');
    expect(await cancelByGuest(id, new Date('2027-06-26T00:00:00Z'))).toMatchObject({
      status: 409,
      reason: 'already_done',
    });
    const token = await manageToken(id);
    const foreign = new NextRequest(`${SITE}/api/manage/cancel`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', [MANAGE_HEADER]: token },
    });
    expect((await cancelRoute(foreign)).status).toBe(403);
    expect((await cancelRoute(post('/api/manage/cancel', null))).status).toBe(403);
    const take = await withTx((c) =>
      issueToken(c, { purpose: 'take_offer', requestId: id, expiresAt: new Date('2027-12-01T00:00:00Z') }),
    );
    expect((await cancelRoute(post('/api/manage/cancel', take))).status).toBe(403); // not a manage token
    expect((await row(id)).status).toBe('locked');
  });

  it('rule 2: a joined guest who cancels leaves the host locked; only their attendee goes (a host patch)', async () => {
    const patch = vi.spyOn(mockCalendar, 'patch');
    const remove = vi.spyOn(mockCalendar, 'remove');
    // Not Thu Apr 1 lunch: the household hold (QA r2 L6) refuses a plain lock there.
    const { id: host } = await lockedRequest('2027-04-02', 'evening');
    const joined = await joinTo(host);
    const res = await cancelByGuest(joined);
    expect(res).toEqual({ ok: true, already: false });
    expect((await row(host)).status).toBe('locked');
    expect((await row(joined)).status).toBe('cancelled');
    expect(remove).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(1);
    const hostEmail = (
      await q<{ e: string }>(`select contact_email::text as e from request where id = $1`, [host])
    )[0]!.e;
    expect(patch.mock.calls[0]![1].attendees).toEqual([hostEmail]);
    expect(await templates(joined)).toEqual(['E11', 'E12']);
  });

  it('rule 4: the host cancels: the event is deleted, the joined guest needs a new time, nobody else is cancelled', async () => {
    const { id: host } = await lockedRequest('2027-04-02');
    const joined = await joinTo(host);
    const left = await joinTo(host); // pr32-review M2: a joined guest who already cancelled is left alone
    await cancelByGuest(left);
    await cancelByGuest(host);
    expect(await cancelByGuest(host)).toEqual({ ok: true, already: true }); // a retried host cancel ...
    expect(await templates(joined)).toEqual(['E5j']); // ... sends no second E5j
    expect((await row(left)).status).toBe('cancelled');
    expect(await templates(left)).toEqual(['E11', 'E12']);
    expect(await q(`select 1 from audit_log where request_id = $1 and action = 'host_left'`, [left])).toEqual(
      [],
    );
    expect((await row(host)).status).toBe('cancelled');
    expect(await row(joined)).toMatchObject({
      status: 'needs_new_time',
      joined_to_request_id: host,
      awaiting_jon_since: NOW,
    });
    expect((await row(host)).google_event_id).toBeNull();
    // E5j to the joined guest, once (event key = the host's cancel audit row), sent, never naming the host.
    expect(await templates(joined)).toEqual(['E5j']);
    const [e5j] = await q<{ status: string; event_key: string }>(
      `select status, event_key from email_log where request_id = $1 and template = 'E5j'`,
      [joined],
    );
    const [hostAudit] = await q<{ id: string }>(
      `select id from audit_log where request_id = $1 and action = 'request_cancelled'`,
      [host],
    );
    expect(e5j).toEqual({ status: 'sent', event_key: hostAudit!.id });
    const [sent] = await q<{ text_body: string }>(
      `select d.text_body from dev_outbox d join request r on r.contact_email = d.to_email
        where r.id = $1 and d.template = 'E5j'`,
      [joined],
    );
    expect(sent!.text_body).toContain('That plan fell through, so your spot on it is off.');
    expect(sent!.text_body).not.toContain('Dave');
    // The template check is a pattern now (migration 20261102000300): E5j passes, junk does not.
    await expect(
      q(`insert into email_log (template, to_email) values ('X5', 'x@example.com')`),
    ).rejects.toThrow(/email_log_template_pattern/);
  });
});

describe("ENG-13: once the booking has started it is no longer the guest's to cancel or re-ask", () => {
  it('the page hides Cancel and Ask for another time, the server refuses both; Jon can still cancel', async () => {
    const { id, slot } = await lockedRequest('2027-05-21');
    const token = await manageToken(id);
    const [{ starts_at: start }] = (await q<{ starts_at: Date }>(`select starts_at from slot where id = $1`, [
      slot,
    ])) as [{ starts_at: Date }];
    const before = new Date(start.getTime() - 60_000);
    const during = new Date(start.getTime() + 30 * 60_000);
    expect(await loadManageModel(token, before)).toMatchObject({ canCancel: true, canAskAnother: true });
    expect(await loadManageModel(token, during)).toMatchObject({
      status: 'locked',
      canCancel: false,
      canAskAnother: false,
    });
    expect(await cancelByGuest(id, during)).toMatchObject({ ok: false, status: 409, reason: 'already_done' });
    const later = await slotId('2027-06-24', 'lunch');
    expect(
      await rerequest(id, { slotIds: [later], dates: [], overnight: false }, during, {
        clientKey: randomUUID(),
      }),
    ).toEqual({ ok: false, status: 409, reason: 'not_changeable' });
    expect((await row(id)).status).toBe('locked');
    expect(await cancelForGuest(id, during)).toMatchObject({ ok: true });
  });
});

describe('Ask for another time (T2.7.05, E16) and the manage grant (T2.7.02, AC6)', () => {
  // CR-04: three routes end to end (picker, re-request, calendar delete), so on a loaded runner it outgrows the
  // 5 s default (its own timeout below). The next case keeps its second lock out of this week, so a half-done run
  // here (its lock left behind) can't make that case find the week full.
  it('AC6: after the general link is rotated, the manage link still opens the picker and re-requests end to end', async () => {
    const remove = vi.spyOn(mockCalendar, 'remove');
    const { id, slot } = await lockedRequest('2027-05-13');
    const token = await manageToken(id);
    await q(`update invite set revoked_at = now() where id = $1`, [generalId]);
    rotatedId = (
      await q<{ id: string }>(
        `insert into invite (kind, token_secret, name_slug, is_test) values ('general', 'z9z9z9z9', 'friends', true) returning id`,
      )
    )[0]!.id;

    // The picker: no cookie at all, only the manage header. The guest's own booking doesn't hide or cap the rest
    // of their week, but the time they're booked on isn't offered back (QA4 L2: it would un-book and re-ask it).
    const pick = await availability(
      new NextRequest(`${SITE}/api/availability?dish=the-long-lunch`, {
        headers: { [MANAGE_HEADER]: token },
      }),
    );
    expect(pick.status).toBe(200);
    const weeks = (await pick.json()) as { weeks: { windows: { slotId: string }[] }[] };
    const listed = weeks.weeks.flatMap((w) => w.windows.map((x) => x.slotId));
    expect(listed).not.toContain(slot);
    expect(listed).toContain(await slotId('2027-05-14', 'lunch'));
    const other = await availability(
      new NextRequest(`${SITE}/api/availability?dish=the-encore`, { headers: { [MANAGE_HEADER]: token } }),
    );
    expect(other.status).toBe(403); // this request's dish only
    const noGrant = await availability(new NextRequest(`${SITE}/api/availability?dish=the-long-lunch`));
    expect(noGrant.status).toBe(403);

    const target = await slotId('2027-05-14', 'lunch');
    const res = await anotherTimeRoute(
      post('/api/manage/another-time', token, { slotIds: [target], clientKey: randomUUID() }),
    );
    expect(res.status).toBe(200);
    expect(await row(id)).toMatchObject({
      status: 'requested',
      locked_starts_at: null,
      google_event_id: null,
      calendar_state: 'none',
      awaiting_jon_since: NOW,
    });
    expect(remove).toHaveBeenCalledTimes(1);
    const choices = await q<{ slot_id: string }>(
      `select slot_id from request_slot_choice where request_id = $1`,
      [id],
    );
    expect(choices.map((c) => c.slot_id)).toEqual([target]);
    expect(await templates(id)).toContain('E16');
    expect(await isOpen(slot)).toBe(true);
  }, 60_000);

  it('refuses a body request_id, a gone time and a done booking; nothing changes', async () => {
    const { id } = await lockedRequest('2027-05-13', 'evening');
    const token = await manageToken(id);
    const bad = await anotherTimeRoute(
      post('/api/manage/another-time', token, { slotIds: [], requestId: randomUUID() }),
    );
    expect(bad.status).toBe(400);
    // CR-04: a week of its own (Fri Apr 16), not AC6's, which may still hold a lock if AC6 failed half-way.
    const { slot: taken } = await lockedRequest('2027-04-16');
    const gone = await anotherTimeRoute(
      post('/api/manage/another-time', token, { slotIds: [taken], clientKey: randomUUID() }),
    );
    expect(gone.status).toBe(409);
    expect(await gone.json()).toMatchObject({ code: 'time_gone' });
    const later = await slotId('2027-06-24', 'lunch'); // open, but this booking has already ended by then
    expect(
      await rerequest(
        id,
        { slotIds: [later], dates: [], overnight: false },
        new Date('2027-05-15T12:00:00Z'),
        { clientKey: randomUUID() },
      ),
    ).toEqual({ ok: false, status: 409, reason: 'not_changeable' });
    expect((await row(id)).status).toBe('locked');
  });

  it('rule 4 via Ask for another time: the host re-requests; the joined guest needs a new time and gets E5j', async () => {
    const { id: host } = await lockedRequest('2027-06-25', 'evening');
    const joined = await joinTo(host);
    const target = await slotId('2027-06-24', 'lunch');
    expect(
      await rerequest(host, { slotIds: [target], dates: [], overnight: false }, NOW, {
        clientKey: randomUUID(),
      }),
    ).toEqual({
      ok: true,
    });
    expect((await row(joined)).status).toBe('needs_new_time');
    expect(await templates(joined)).toEqual(['E5j']);
    await cancelRoute(post('/api/manage/cancel', await manageToken(host))); // the host leaves for good: no second E5j
    expect(await templates(joined)).toEqual(['E5j']);
  });

  it('a re-requested booking keeps its manage link past the old end + 7 days (B001)', async () => {
    const { id } = await lockedRequest('2027-05-20');
    const raw = await manageToken(id); // issued after the lock: lasts to the booking's end + 7 days
    const target = await slotId('2027-05-21', 'lunch');
    expect(
      await rerequest(id, { slotIds: [target], dates: [], overnight: false }, NOW, {
        clientKey: randomUUID(),
      }),
    ).toEqual({ ok: true });
    expect((await row(id)).status).toBe('requested');
    // Jon hasn't answered 10 days after the old end: the request is still open, so the link still works.
    expect(await manageGrant(raw, new Date('2027-05-30T18:00:00Z'))).toBe(id);
  });

  it("a host leaving keeps the joined guest's manage link past the host's old end + 7 days (B001)", async () => {
    const { id: host } = await lockedRequest('2027-06-10', 'evening');
    const joined = await joinTo(host);
    const raw = await manageToken(joined); // the host's end + 7 days
    const target = await slotId('2027-06-11', 'lunch');
    expect(
      await rerequest(host, { slotIds: [target], dates: [], overnight: false }, NOW, {
        clientKey: randomUUID(),
      }),
    ).toEqual({ ok: true });
    expect((await row(joined)).status).toBe('needs_new_time');
    expect(await manageGrant(raw, new Date('2027-06-27T18:00:00Z'))).toBe(joined);
  });

  it('a bad manage header never falls back to a valid invite cookie; the manage routes are rate limited per IP', async () => {
    const [active] = await q<{ id: string }>(
      `select id from invite where kind = 'general' and revoked_at is null`,
    );
    jar.set(INVITE_COOKIE, signCookie('invite', active!.id, 3600, process.env.SESSION_SIGNING_SECRET!));
    const withCookie = await availability(new NextRequest(`${SITE}/api/availability?dish=the-long-lunch`));
    expect(withCookie.status).toBe(200);
    const badHeader = await availability(
      new NextRequest(`${SITE}/api/availability?dish=the-long-lunch`, {
        headers: { [MANAGE_HEADER]: randomBytes(32).toString('base64url') },
      }),
    );
    expect(badHeader.status).toBe(403);

    const id = await newRequest([]);
    const token = await manageToken(id);
    await q(
      `insert into rate_limit (scope, key, window_start, count)
       values ('manageAction', 'local', date_bin(interval '3600 seconds', now(), timestamptz 'epoch'), 1000)
       on conflict (scope, key, window_start) do update set count = 1000`,
    );
    try {
      const res = await anotherTimeRoute(post('/api/manage/another-time', token, { slotIds: [] }));
      expect(res.status).toBe(429);
      expect((await cancelRoute(post('/api/manage/cancel', token))).status).toBe(429);
      expect((await row(id)).status).toBe('requested');
    } finally {
      await q(`delete from rate_limit where scope = 'manageAction'`);
    }
  });

  it('a filled honeypot on Ask for another time is stored as spam_suspect, never refused, and sends no E16', async () => {
    const id = await newRequest([]);
    const target = await slotId('2027-06-24', 'lunch');
    const res = await anotherTimeRoute(
      post('/api/manage/another-time', await manageToken(id), {
        slotIds: [target],
        hp: 'autofill',
        clientKey: randomUUID(),
      }),
    );
    expect(res.status).toBe(200);
    const [r] = await q<{ status: string; spam_suspect: boolean; awaiting_jon_since: Date | null }>(
      `select status, spam_suspect, awaiting_jon_since from request where id = $1`,
      [id],
    );
    expect(r).toEqual({ status: 'requested', spam_suspect: true, awaiting_jon_since: null });
    expect(await templates(id)).toEqual([]);
  });

  it('06-F a re-request that is no longer overnight drops "Which night?"', async () => {
    const id = await newRequest([]);
    await q(`update request set overnight = true, overnight_night = 'Saturday' where id = $1`, [id]);
    const target = await slotId('2027-06-24', 'lunch');
    expect(
      await rerequest(id, { slotIds: [target], dates: [], overnight: false }, NOW, {
        clientKey: randomUUID(),
      }),
    ).toEqual({ ok: true });
    const [r] = await q<{ overnight: boolean; overnight_night: string | null }>(
      `select overnight, overnight_night from request where id = $1`,
      [id],
    );
    expect(r).toEqual({ overnight: false, overnight_night: null });
  });

  it('pr80-review F2: an overnight re-request replaces "Which night?" (never keeps the old one)', async () => {
    const id = await newRequest([]);
    await q(
      `update request set dish = 'the-shore-ride', overnight = true, overnight_night = 'Saturday' where id = $1`,
      [id],
    );
    const night = async () =>
      (await q<{ n: string | null }>(`select overnight_night as n from request where id = $1`, [id]))[0]!.n;
    const again = (overnightNight?: string) =>
      rerequest(id, { slotIds: [], dates: ['2027-05-15'], overnight: true, overnightNight }, NOW, {
        clientKey: randomUUID(),
      });
    expect(await again('Friday')).toEqual({ ok: true });
    expect(await night()).toBe('Friday');
    expect(await again()).toEqual({ ok: true });
    expect(await night()).toBeNull();
    // F1: the column has its own 60-character cap, not only the Zod one.
    await expect(
      q(`update request set overnight_night = repeat('x', 61) where id = $1`, [id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('pr32-review M1: the same submit twice (a double tap, or a retry) changes the row once: one audit, one E16', async () => {
    const id = await newRequest([]);
    const token = await manageToken(id);
    const body = { slotIds: [await slotId('2027-06-24', 'lunch')], clientKey: randomUUID() };
    const res = await Promise.all(
      [1, 2].map(() => anotherTimeRoute(post('/api/manage/another-time', token, body))),
    );
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    expect(await anotherTimeRoute(post('/api/manage/another-time', token, body)).then((r) => r.status)).toBe(
      200,
    );
    expect(await templates(id)).toEqual(['E16']);
    const audits = await q(
      `select 1 from audit_log where request_id = $1 and action = 'request_rerequested'`,
      [id],
    );
    expect(audits).toHaveLength(1);
    const [e16] = await q<{ k: string }>(
      `select event_key as k from email_log where request_id = $1 and template = 'E16'`,
      [id],
    );
    expect(e16!.k).toBe(body.clientKey); // the email's own idempotency key is the submit (belt and braces)
    // A new submit (a new key) is a new change.
    await anotherTimeRoute(post('/api/manage/another-time', token, { ...body, clientKey: randomUUID() }));
    expect(await templates(id)).toEqual(['E16', 'E16']);
    const noKey = await anotherTimeRoute(post('/api/manage/another-time', token, { slotIds: body.slotIds }));
    expect(noKey.status).toBe(400);
  });

  it('ENG-03/ENG-14: a retry is answered from what it did, even once its time went; other choices under its key are refused', async () => {
    const id = await newRequest([]);
    const token = await manageToken(id);
    const asked = await slotId('2027-06-24', 'lunch');
    const body = { slotIds: [asked], clientKey: randomUUID() };
    expect((await anotherTimeRoute(post('/api/manage/another-time', token, body))).status).toBe(200);
    // Someone else's booking takes that time: the retry still gets its original success, not "that one went".
    const { id: other } = await lockedRequest('2027-06-24');
    expect((await anotherTimeRoute(post('/api/manage/another-time', token, body))).status).toBe(200);
    const edited = await anotherTimeRoute(
      post('/api/manage/another-time', token, { ...body, slotIds: [await slotId('2027-06-25', 'lunch')] }),
    );
    expect(edited.status).toBe(409);
    expect(await edited.json()).toMatchObject({ code: 'replay_conflict', message: ERRORS.generic });
    const picks = await q<{ slot_id: string }>(
      `select slot_id from request_slot_choice where request_id = $1`,
      [id],
    );
    expect(picks.map((p) => p.slot_id)).toEqual([asked]);
    expect(await templates(id)).toEqual(['E16']);
    await q(`update request set status = 'cancelled' where id = $1`, [other]);
  });

  it('rule 5: a joined guest who asks for another time detaches; the host keeps its event without them', async () => {
    const patch = vi.spyOn(mockCalendar, 'patch');
    const { id: host } = await lockedRequest('2027-04-01', 'evening');
    const joined = await joinTo(host);
    const target = await slotId('2027-06-24', 'lunch');
    expect(
      await rerequest(joined, { slotIds: [target], dates: [], overnight: false }, NOW, {
        clientKey: randomUUID(),
      }),
    ).toEqual({
      ok: true,
    });
    expect(await row(joined)).toMatchObject({ status: 'requested', joined_to_request_id: null });
    expect((await row(host)).status).toBe('locked');
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![1].attendees).toHaveLength(1);
    expect(await templates(joined)).toEqual(['E16']);
  });
});

describe('Add a story or photo through the manage grant (T2.7.06)', () => {
  it("saves to the manage token's own request, even with a twj_req for another request in the jar", async () => {
    const mine = await newRequest([]);
    const other = await newRequest([]);
    // On a live invite: AC6 above rotated (revoked) the general link, and a request cookie only works while its
    // invite is live.
    await q(`update request set invite_id = (select id from invite where name_slug = 'dave') where id = $1`, [
      other,
    ]);
    jar.set(REQ_COOKIE, signCookie('req', other, 3600, process.env.SESSION_SIGNING_SECRET!));
    const token = await manageToken(mine);
    const res = await storyRoute(post('/api/stories', token, { body: 'We got lost', consent: true }));
    expect(res.status).toBe(200);
    expect(await q(`select 1 from story where request_id = $1`, [mine])).toHaveLength(1);
    expect(await q(`select 1 from story where request_id = $1`, [other])).toHaveLength(0);
    expect((await photoSign(post('/api/photos/sign', token))).status).toBe(200);
    // A bad manage header never falls back to the cookie.
    expect((await storyRoute(post('/api/stories', 'x'.repeat(43), { body: 'x' }))).status).toBe(403);
    // No header: the twj_req cookie still works as before (T1.8).
    expect((await storyRoute(post('/api/stories', null, { body: 'hi' }))).status).toBe(200);
    expect(await q(`select 1 from story where request_id = $1`, [other])).toHaveLength(1);
  });
});

describe('after Jon cancels for the guest (2026-10-05): "Cancelled, no problem" and Ask for another time', () => {
  it('the page says so and offers Ask for another time; new times go back to Jon as a re-request', async () => {
    const { id } = await lockedRequest('2027-06-10');
    const token = await manageToken(id);
    expect((await cancelForGuest(id)).ok).toBe(true);
    expect(await loadManageModel(token)).toMatchObject({
      kind: 'manage',
      status: 'cancelled',
      label: JON_CANCELLED_LABEL,
      canCancel: false,
      canAskAnother: true,
      canAddStory: true,
    });

    const target = await slotId('2027-06-11', 'lunch');
    const res = await anotherTimeRoute(
      post('/api/manage/another-time', token, { slotIds: [target], clientKey: randomUUID() }),
    );
    expect(res.status).toBe(200);
    const [r] = await q<{
      status: string;
      cancelled_by: string | null;
      cancelled_at: Date | null;
      awaiting: Date | null;
    }>(
      `select status, cancelled_by::text, cancelled_at, awaiting_jon_since awaiting from request where id = $1`,
      [id],
    );
    expect(r).toEqual({ status: 'requested', cancelled_by: null, cancelled_at: null, awaiting: NOW }); // Jon's inbox
    expect(
      (
        await q<{ slot_id: string }>(`select slot_id from request_slot_choice where request_id = $1`, [id])
      ).map((c) => c.slot_id),
    ).toEqual([target]);
    expect(await templates(id)).toContain('E16');
    // the manage link lives on (the unlocked lifetime, as after Ask for another time from a locked booking)
    expect((await findToken(token))!.expires_at).toEqual(manageExpiry(null, NOW));
    expect(await loadManageModel(token)).toMatchObject({ status: 'requested', label: GUEST_LABEL.requested });
  });

  it("the guest's own cancel is unchanged: 'Cancelled, no guilt', no Ask for another time, and the POST is refused", async () => {
    const { id } = await lockedRequest('2027-06-10', 'evening');
    const token = await manageToken(id);
    expect((await cancelByGuest(id)).ok).toBe(true);
    expect(await loadManageModel(token)).toMatchObject({
      status: 'cancelled',
      label: GUEST_LABEL.cancelled,
      canCancel: false,
      canAskAnother: false,
      canAddStory: true,
    });
    const res = await anotherTimeRoute(
      post('/api/manage/another-time', token, {
        slotIds: [await slotId('2027-06-11', 'lunch')],
        clientKey: randomUUID(),
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'not_changeable' });
    expect((await row(id)).status).toBe('cancelled');
  });
});
