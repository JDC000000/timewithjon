// Guest Send caps, each with both halves: a real guest is never refused, and a scripted flood is capped.
// - Every invite kind has a daily guest-email cap: a personal link 5 E1/E6 a day (the general link's 20 is in
//   requests.int). Over it the request still stands and Jon still gets E2.
// - The per-address E1 cap (3 a day) counts one mailbox however it is written: case, a "+tag", Gmail's dots.
// - The general link takes at most 40 NEW requests a day (each one emails Jon); a replay is never counted.
// - A request cookie (twj_req) stops working once its invite is revoked.
// - On the general link, "the same request again" (Back after Send) is only this browser's own request.
// - An offer is taken only through its own request's token.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  }),
}));

import { POST as requestsRoute } from '@/app/api/requests/route';
import { POST as storiesRoute } from '@/app/api/stories/route';
import { queueEmail } from '@/features/email/send';
import { readRequestCapability, REQ_COOKIE } from '@/features/invites/capability';
import { INVITE_COOKIE } from '@/features/invites/session';
import { signCookie } from '@/features/invites/tokens';
import { createRequest, createRequestTx, findRecentDuplicate } from '@/features/requests/create';
import { createOffer, liveOfferForUpdate } from '@/features/requests/offers';
import { RequestBody } from '@/features/requests/schema';
import { pool, q, withTx } from '@/lib/db';
import { removeRequests } from '../fixtures/requests-db';

const SITE = 'http://localhost:3000';
const made: string[] = [];
let generalId = '';
let personalId = '';
let slot = '';
let saved: { general_open_at: Date; personal_open_at: Date };

const SCOPES = ['requestSend', 'requestSendInvite', 'requestSendPersonalInvite', 'requestGeneralInvite'];
beforeAll(async () => {
  generalId = (
    await q<{ id: string }>(`select id from invite where kind = 'general' and revoked_at is null`)
  )[0]!.id;
  personalId = (await q<{ id: string }>(`select id from invite where name_slug = 'dave'`))[0]!.id;
  slot = (
    await q<{ id: string }>(`select id from slot where date = '2027-04-22' and window_kind = 'lunch'`)
  )[0]!.id;
  [saved] = (await q(`select general_open_at, personal_open_at from settings where id`)) as [typeof saved];
  await q(
    `update settings set general_open_at = now() - interval '1 day', personal_open_at = now() - interval '1 day'`,
  );
});
beforeEach(async () => {
  jar.clear();
  await q(`delete from rate_limit where scope = any($1::text[])`, [SCOPES]);
});
afterAll(async () => {
  await q(`delete from rate_limit where scope = any($1::text[])`, [SCOPES]);
  await q(`update settings set general_open_at = $1, personal_open_at = $2`, [
    saved.general_open_at,
    saved.personal_open_at,
  ]);
  await q(`update invite set revoked_at = null where id = $1`, [personalId]);
  await removeRequests(made);
  await pool().end();
});

const body = (over: Record<string, unknown> = {}) =>
  RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name: 'Dave',
    email: `caps+${randomUUID().slice(0, 8)}@example.com`,
    crew: 1,
    slotIds: [slot],
    ...over,
  });
const args = (b: ReturnType<typeof body>, inviteId: string) => ({
  body: b,
  inviteId,
  isTest: true,
  spam: false,
  mode: 'slots' as const,
  status: 'requested' as const,
  countsToward: 'weekly_cap' as const,
  bigCrew: false,
  dishName: 'The Long Lunch',
});
const templates = async (id: string) =>
  (
    await q<{ template: string }>(`select template from email_log where request_id = $1 order by template`, [
      id,
    ])
  ).map((r) => r.template);
const post = (b: unknown) =>
  requestsRoute(
    new NextRequest(`${SITE}/api/requests`, {
      method: 'POST',
      headers: { origin: SITE, 'content-type': 'application/json' },
      body: JSON.stringify(b),
    }),
  );
const asInvite = (inviteId: string) =>
  jar.set(INVITE_COOKIE, signCookie('invite', inviteId, 3600, process.env.SESSION_SIGNING_SECRET!));

describe('a personal invite has a daily guest-email cap too (5)', () => {
  it('5 requests in a day each get their E1; the 6th is stored and Jon still gets E2, the guest email is skipped', async () => {
    const send = async () => {
      const { requestId } = await createRequest({ ...args(body(), personalId), capGuestEmails: 'personal' });
      made.push(requestId);
      return requestId;
    };
    for (let i = 0; i < 5; i++) expect(await templates(await send()), `send ${i + 1}`).toEqual(['E1', 'E2']);
    const sixth = await send();
    expect(await templates(sixth)).toEqual(['E2']);
    expect(await q(`select 1 from request where id = $1`, [sixth])).toHaveLength(1);
  });
});

describe('the per-address E1 cap counts one mailbox (3 a day)', () => {
  const e1 = (to: string) =>
    withTx((c) =>
      queueEmail(c, {
        template: 'E1',
        to,
        requestId: null,
        eventKey: randomUUID(),
        vars: { dish: 'The Long Lunch' },
      }),
    );
  it('Gmail dots, "+tags" and capitals are one mailbox; another mailbox, and dots or "+" elsewhere, are not', async () => {
    const user = `capbox${randomUUID().slice(0, 6)}`;
    const variants = [
      `${user}@gmail.com`,
      `${user.slice(0, 3)}.${user.slice(3)}@gmail.com`,
      `${user}+x@googlemail.com`,
    ];
    for (const to of variants) expect(typeof (await e1(to))).toBe('object');
    expect(await e1(`${user.toUpperCase()}+other@gmail.com`)).toBe('capped');
    expect(typeof (await e1(`${user}z@gmail.com`))).toBe('object'); // someone else
    // Outside Gmail a dot or a "+" can be a different mailbox: not merged.
    const dotted = `a.${user}@example.com`;
    for (let i = 0; i < 3; i++) expect(typeof (await e1(dotted))).toBe('object');
    expect(typeof (await e1(`a${user}@example.com`))).toBe('object');
    expect(typeof (await e1(`a.${user}+x@example.com`))).toBe('object');
    await q(`delete from email_log where to_email ilike $1`, [`%${user}%`]);
  });
});

describe('the general link takes at most 40 new requests a day', () => {
  it('under the cap a guest is never refused; over it a new request is refused (429) and nothing is stored; a retry still answers', async () => {
    asInvite(generalId);
    const first = body();
    const ok = await post(first);
    expect(ok.status).toBe(200);
    const [{ id }] = (await q<{ id: string }>(`select id from request where client_key = $1`, [
      first.clientKey,
    ])) as [{ id: string }];
    made.push(id);
    await q(`update rate_limit set count = 40 where scope = 'requestGeneralInvite' and key = $1`, [
      generalId,
    ]);
    const flood = body();
    const refused = await post(flood);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ ok: false, code: 'rate_limited' });
    expect(await q(`select 1 from request where client_key = $1`, [flood.clientKey])).toHaveLength(0);
    expect((await post(first)).status).toBe(200); // the saved request's retry is never counted or refused
    // A personal invite isn't held by the general link's count.
    asInvite(personalId);
    const own = body();
    expect((await post(own)).status).toBe(200);
    made.push(
      ...(await q<{ id: string }>(`select id from request where client_key = $1`, [own.clientKey])).map(
        (r) => r.id,
      ),
    );
  });
});

describe('a request cookie after its invite is revoked', () => {
  it('works while the invite is live; once it is revoked, no capability: stories are refused', async () => {
    const { requestId } = await withTx((c) => createRequestTx(c, args(body(), personalId)));
    made.push(requestId);
    jar.set(REQ_COOKIE, signCookie('req', requestId, 3600, process.env.SESSION_SIGNING_SECRET!));
    const story = () =>
      storiesRoute(
        new NextRequest(`${SITE}/api/stories`, {
          method: 'POST',
          headers: { origin: SITE, 'content-type': 'application/json' },
          body: JSON.stringify({ body: 'We had lunch.', consent: true }),
        }),
      );
    expect(await readRequestCapability()).toBe(requestId);
    expect((await story()).status).toBe(200);
    await q(`update invite set revoked_at = now() where id = $1`, [personalId]);
    try {
      expect(await readRequestCapability()).toBeNull();
      expect((await story()).status).not.toBe(200);
    } finally {
      await q(`update invite set revoked_at = null where id = $1`, [personalId]);
    }
  });
});

describe('Back after Send on the shared general link', () => {
  it('"the same request" is only the one this browser sent, never another guest\'s identical one', async () => {
    const b = body();
    const { requestId } = await withTx((c) => createRequestTx(c, args(b, generalId)));
    made.push(requestId);
    const again = { ...b, clientKey: randomUUID() };
    expect(await findRecentDuplicate(again, generalId, requestId)).toBe(requestId); // its own browser
    expect(await findRecentDuplicate(again, generalId, randomUUID())).toBeNull(); // another browser's request
    expect(await findRecentDuplicate(again, generalId)).toBe(requestId); // a personal link's lookup is unscoped
  });
});

describe('an offer is taken only through its own request', () => {
  it('liveOfferForUpdate finds the offer for its request, and nothing for another request', async () => {
    const mine = await withTx((c) => createRequestTx(c, args(body(), personalId)));
    const other = await withTx((c) => createRequestTx(c, args(body(), personalId)));
    made.push(mine.requestId, other.requestId);
    const offerId = await withTx((c) =>
      createOffer(c, { requestId: mine.requestId, kind: 'suggested_times', slotIds: [slot] }),
    );
    expect(await withTx((c) => liveOfferForUpdate(c, offerId, mine.requestId, new Date()))).toMatchObject({
      id: offerId,
    });
    expect(await withTx((c) => liveOfferForUpdate(c, offerId, other.requestId, new Date()))).toBeNull();
  });
});
