// T1.7.11 (review L9): POST /api/requests end to end on a real prototype server + the loopback test DB.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ERRORS } from '@/content';
import { VALIDATION_MESSAGE } from '@/features/requests/messages';
import { pool, q } from '@/lib/db';

const BASE = process.env.ROUTE_BASE_URL ?? 'http://127.0.0.1:3200';
const GENERAL_LINK = '/?for=friends-g3hx8q2v';

async function inviteCookie(): Promise<string> {
  const res = await fetch(`${BASE}${GENERAL_LINK}`, { redirect: 'manual' });
  const c = res.headers.getSetCookie().find((h) => h.startsWith('twj_invite='));
  if (!c) throw new Error(`no twj_invite cookie (status ${res.status})`);
  return c.split(';')[0]!;
}
async function post(body: unknown, opts: { cookie?: string; origin?: string } = {}) {
  const res = await fetch(`${BASE}/api/requests`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: opts.origin ?? BASE,
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return { res, json: (await res.json()) as { ok: boolean; code?: string; message?: string } };
}

let cookie = '';
let goodSlot = '';
let blockedSlot = '';
let saved: { general_open_at: Date };
const email = (tag: string) => `route-${tag}-${randomUUID().slice(0, 8)}@example.com`;
const body = (over: Record<string, unknown> = {}) => ({
  clientKey: randomUUID(),
  dish: 'the-long-lunch',
  name: 'Route Test',
  email: email('ok'),
  crew: 2,
  slotIds: [goodSlot],
  ...over,
});
const requestFor = async (contactEmail: string) =>
  await q<{ id: string; spam_suspect: boolean }>(
    `select id, spam_suspect from request where contact_email = $1`,
    [contactEmail],
  );
const templatesFor = async (requestId: string) =>
  (
    await q<{ template: string }>(
      `select template from email_log where request_id = $1 and status = 'sent' order by template`,
      [requestId],
    )
  ).map((r) => r.template);
const outboxFor = async (to: string) =>
  (
    await q<{ template: string }>(`select template from dev_outbox where to_email = $1 order by template`, [
      to,
    ])
  ).map((r) => r.template);

beforeAll(async () => {
  // Off Vercel every caller shares one rate-limit bucket (T4.2.01a M2), so start this suite from a clean slate
  // (the loopback TEST database only).
  await q(`delete from rate_limit`);
  [saved] = (await q<{ general_open_at: Date }>(`select general_open_at from settings where id`)) as [
    { general_open_at: Date },
  ];
  await q(`update settings set general_open_at = now() - interval '1 day'`); // the season opens in 2027
  goodSlot = (
    await q<{ id: string }>(`select id from slot where date = '2027-04-22' and window_kind = 'lunch'`)
  )[0]!.id;
  blockedSlot = (
    await q<{ id: string }>(`select id from slot where date = '2027-04-29' and window_kind = 'lunch'`)
  )[0]!.id;
  await q(
    `insert into availability_block (start_date, end_date, kind, note) values ('2027-04-29', '2027-04-29', 'blocked', 'route test')`,
  );
  await q(`update week set cap_override = 0 where week_start = '2027-05-03'`); // a spoken-for week for stand-by
  cookie = await inviteCookie();
});
afterAll(async () => {
  await q(`update settings set general_open_at = $1`, [saved.general_open_at]);
  await q(`delete from availability_block where note = 'route test'`);
  await q(`update week set cap_override = null where week_start = '2027-05-03'`);
  await pool().end();
});

describe('POST /api/requests (route level)', () => {
  it('no invite → 403 invite_required', async () => {
    const { res, json } = await post(body());
    expect(res.status).toBe(403);
    expect(json).toMatchObject({ code: 'invite_required', message: ERRORS.noInvite });
  });
  it('before the release time → 403 not_released', async () => {
    await q(`update settings set general_open_at = now() + interval '1 day'`);
    try {
      const { res, json } = await post(body(), { cookie });
      expect(res.status).toBe(403);
      expect(json.code).toBe('not_released');
    } finally {
      await q(`update settings set general_open_at = now() - interval '1 day'`);
    }
  });
  it('a foreign Origin → 403', async () => {
    const { res, json } = await post(body(), { cookie, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(json.code).toBe('bad_origin');
  });
  it('a bad email → 400 with the badEmail line', async () => {
    const { res, json } = await post(body({ email: 'not-an-email' }), { cookie });
    expect(res.status).toBe(400);
    expect(json).toMatchObject({ code: 'email_invalid', message: ERRORS.badEmail });
  });
  it('an unknown dish → 400', async () => {
    const { res, json } = await post(body({ dish: 'the-mystery-dish' }), { cookie });
    expect(res.status).toBe(400);
    expect(json.code).toBe('unknown_dish');
  });
  it('a blocked slot → 409 with the VALIDATION_MESSAGE line', async () => {
    const { res, json } = await post(body({ slotIds: [blockedSlot] }), { cookie });
    expect(res.status).toBe(409);
    expect(json).toMatchObject({ code: 'time_gone', message: VALIDATION_MESSAGE.time_gone });
  });
  it('Q9 a crew over the dish max → 409 crew_out_of_range, nothing stored; one inside is stored as crew_size', async () => {
    const over = email('crew16');
    const { res, json } = await post(body({ email: over, crew: 16 }), { cookie }); // The Long Lunch serves 1–15
    expect(res.status).toBe(409);
    expect(json).toMatchObject({ code: 'crew_out_of_range', message: ERRORS.generic });
    expect(await requestFor(over)).toEqual([]);
    const ok = email('crew5');
    expect((await post(body({ email: ok, crew: 5 }), { cookie })).res.status).toBe(200);
    expect(await q(`select crew_size, big_crew from request where contact_email = $1`, [ok])).toEqual([
      { crew_size: 5, big_crew: false },
    ]);
  });
  it('the honeypot filled → 200, spam_suspect, and no E1/E2', async () => {
    const b = body({ email: email('spam'), hp: 'http://spam.example' });
    const { res } = await post(b, { cookie });
    expect(res.status).toBe(200);
    const [r] = await requestFor(b.email as string);
    expect(r!.spam_suspect).toBe(true);
    expect(await templatesFor(r!.id)).toEqual([]);
    expect(await outboxFor(b.email as string)).toEqual([]);
  });
  it('a good request → 200 + twj_req + E1 (guest) and E2 (Jon); a replay → same result, one row', async () => {
    const b = body({ email: email('good') });
    const { res, json } = await post(b, { cookie });
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true });
    expect(res.headers.getSetCookie().some((c) => c.startsWith('twj_req='))).toBe(true);
    const [r] = await requestFor(b.email as string);
    expect(await templatesFor(r!.id)).toEqual(['E1', 'E2']);
    expect(await outboxFor(b.email as string)).toEqual(['E1']);
    const again = await post(b, { cookie });
    expect(again.res.status).toBe(200);
    expect(await requestFor(b.email as string)).toHaveLength(1);
    expect(await outboxFor(b.email as string)).toEqual(['E1']);
  });
  it('stand-by on a spoken-for week → E6 + E2, never E1', async () => {
    const b = body({ email: email('standby'), slotIds: [], standbyWeek: '2027-05-03' });
    const { res } = await post(b, { cookie });
    expect(res.status).toBe(200);
    const [r] = await requestFor(b.email as string);
    expect(await templatesFor(r!.id)).toEqual(['E2', 'E6']);
    expect(await outboxFor(b.email as string)).toEqual(['E6']);
  });

  it('ENG-03/ENG-01: a retry gets its saved request even after its time went; an edited body under its key is refused', async () => {
    await q(`delete from rate_limit`); // off Vercel every caller shares one bucket
    const friLunch = (
      await q<{ id: string }>(`select id from slot where date = '2027-04-23' and window_kind = 'lunch'`)
    )[0]!.id;
    const b = body({ email: email('retry'), slotIds: [friLunch] });
    expect((await post(b, { cookie })).res.status).toBe(200);
    // The time goes (a block here; a lock does the same): the retry still answers with the saved request.
    await q(
      `insert into availability_block (start_date, end_date, kind, note) values ('2027-04-23', '2027-04-23', 'blocked', 'route test')`,
    );
    const again = await post(b, { cookie });
    expect([again.res.status, again.json.ok]).toEqual([200, true]);
    expect(await requestFor(b.email as string)).toHaveLength(1);
    // The guest fixed a typo in the email under the same key: refused, never "sent to" an address nothing went to.
    const fixed = email('fixed');
    const edited = await post({ ...b, email: fixed }, { cookie });
    expect(edited.res.status).toBe(409);
    expect(edited.json).toMatchObject({ ok: false, code: 'replay_conflict' });
    expect(await requestFor(fixed)).toEqual([]);
    await q(`delete from rate_limit`);
  });

  it('QA4b M1: Back after Send, then Send (a new key, the same request) gets the one already sent; a different one is new', async () => {
    await q(`delete from rate_limit`);
    const b = body({ email: email('back') });
    const first = await post(b, { cookie });
    expect(first.res.status).toBe(200);
    // The browser keeps the request cookie the first Send set; on the shared general link only that browser's
    // own request counts as "the same request again".
    const req = first.res.headers
      .getSetCookie()
      .find((c) => c.startsWith('twj_req='))!
      .split(';')[0]!;
    const again = await post({ ...b, clientKey: randomUUID() }, { cookie: `${cookie}; ${req}` });
    expect([again.res.status, again.json.ok]).toEqual([200, true]);
    expect(await requestFor(b.email as string)).toHaveLength(1);
    expect(await outboxFor(b.email as string)).toEqual(['E1']); // no second "Got it"
    const other = await post(
      { ...b, clientKey: randomUUID(), note: 'And my partner' },
      { cookie: `${cookie}; ${req}` },
    );
    expect(other.res.status).toBe(200);
    expect(await requestFor(b.email as string)).toHaveLength(2);
    // Another browser on the shared link with an identical body: its own request, never this guest's.
    const elsewhere = await post({ ...b, clientKey: randomUUID() }, { cookie });
    expect(elsewhere.res.status).toBe(200);
    expect(await requestFor(b.email as string)).toHaveLength(3);
    // ...and that browser never gets the first guest's request cookie (it names its own request).
    const theirs = elsewhere.res.headers
      .getSetCookie()
      .find((c) => c.startsWith('twj_req='))!
      .split(';')[0]!;
    expect(theirs).not.toBe(req);
    await q(`delete from rate_limit`);
  });

  // T3.8 AC3 end to end: the limiter runs before the invite check, so even refused probes count.
  it('the 31st request from one IP in an hour → the friendly 429 (QA4 M3: 30, sliding)', async () => {
    await q(`delete from rate_limit`);
    for (let i = 1; i <= 30; i++) expect((await post(body())).res.status, `send ${i}`).toBe(403);
    const { res, json } = await post(body(), { cookie });
    expect(res.status).toBe(429);
    expect(json).toEqual({ ok: false, code: 'rate_limited', message: ERRORS.rateLimited });
    await q(`delete from rate_limit`);
  });
  it('T3.8.03 a filled story honeypot, even oversize (review F2) → the same 200, stored as spam_suspect', async () => {
    await q(`delete from rate_limit`);
    const b = body({ email: email('story-hp') });
    const sent = await post(b, { cookie });
    const req = sent.res.headers
      .getSetCookie()
      .find((c) => c.startsWith('twj_req='))!
      .split(';')[0]!;
    const res = await fetch(`${BASE}/api/stories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, cookie: req },
      body: JSON.stringify({ body: 'Buy cheap watches', consent: true, hp: 'x'.repeat(300) }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [r] = await requestFor(b.email as string);
    const [s] = await q<{ spam_suspect: boolean }>(`select spam_suspect from story where request_id = $1`, [
      r!.id,
    ]);
    expect(s!.spam_suspect).toBe(true);
    const signed = await fetch(`${BASE}/api/photos/sign`, {
      method: 'POST',
      headers: { origin: BASE, cookie: req },
    });
    expect(signed.status).toBe(200);
    expect(signed.headers.get('cache-control')).toBe('no-store'); // review F4: the upload token is never cached
  });
});
