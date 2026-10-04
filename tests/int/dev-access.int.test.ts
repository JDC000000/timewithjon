// T1.10.10 (review L4) + T1.8.02: /dev access via a POSTed passphrase -> twj_dev cookie, never ?pass=;
// photo sign needs the twj_req capability (T3.6.02: prototype still answers { mock: true }).
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  }),
}));

import { GET as loginForm, POST as login } from '@/app/dev/login/route.dev';
import Outbox from '@/app/dev/outbox/page.dev';
import { POST as photoSign } from '@/app/api/photos/sign/route';
import { devCookieValue, devGuard, DEV_COOKIE, passphraseTag } from '@/features/dev/guard';
import { signCookie } from '@/features/invites/tokens';
import { randomUUID } from 'node:crypto';
import { pool, q, withTx } from '@/lib/db';
import { createRequestTx } from '@/features/requests/create';
import { RequestBody } from '@/features/requests/schema';

const SITE = 'http://localhost:3000';
const PASS = process.env.DEV_PASSPHRASE!;
const loginWith = (pass: string, ip: string) =>
  login(
    new NextRequest(`${SITE}/dev/login`, {
      method: 'POST',
      body: new URLSearchParams({ pass }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip },
    }),
  );
const expectNotFound = async (p: Promise<unknown>) =>
  expect(p).rejects.toMatchObject({ digest: expect.stringContaining('404') });

beforeEach(() => jar.clear());
afterAll(async () => {
  await pool().end();
});

describe('/dev access (T1.10.10)', () => {
  it('/dev/outbox with ?pass= but no cookie is a 404 (the page ignores query strings)', async () => {
    await expectNotFound(Outbox());
  });
  it('POST /dev/login with the right passphrase sets a strict, HttpOnly, /dev-scoped cookie; the outbox renders', async () => {
    expect((await loginForm()).status).toBe(200);
    const res = await loginWith(PASS, '10.7.0.1');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${SITE}/dev/outbox`); // no passphrase in any URL
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toMatch(/^twj_dev=/);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=strict/i);
    expect(set).toMatch(/Path=\/dev/);
    expect(set).not.toContain(PASS);
    jar.set(DEV_COOKIE, res.cookies.get(DEV_COOKIE)!.value);
    await expect(Outbox()).resolves.toBeTruthy();
  });
  it('a wrong passphrase is a 404 with no cookie', async () => {
    const res = await loginWith('not-the-passphrase', '10.7.0.2');
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
  it('devGuard accepts the header or the cookie, never ?pass=; an invite cookie is not a dev cookie', async () => {
    const req = (init: { url?: string; headers?: Record<string, string> }) =>
      new NextRequest(init.url ?? `${SITE}/dev/tick`, { method: 'POST', headers: init.headers });
    expect(await devGuard(req({ headers: { 'x-dev-pass': PASS } }))).toBeNull();
    const cookie = `${DEV_COOKIE}=${devCookieValue()}`;
    expect(await devGuard(req({ headers: { cookie, origin: SITE } }))).toBeNull();
    // AD-7: a cookie-authenticated POST from another origin, or with no Origin, is refused.
    expect((await devGuard(req({ headers: { cookie, origin: 'https://elsewhere.example' } })))?.status).toBe(
      403,
    );
    expect((await devGuard(req({ headers: { cookie } })))?.status).toBe(403);
    expect(
      await devGuard(new NextRequest(`${SITE}/dev/tick`, { method: 'GET', headers: { cookie } })),
    ).toBeNull();
    // The header (scripts) needs no Origin.
    expect(
      await devGuard(req({ headers: { 'x-dev-pass': PASS, origin: 'https://elsewhere.example' } })),
    ).toBeNull();
    expect((await devGuard(req({ url: `${SITE}/dev/tick?pass=${PASS}` })))?.status).toBe(404);
    const invite = signCookie('invite', passphraseTag(), 3600, process.env.SESSION_SIGNING_SECRET!);
    expect((await devGuard(req({ headers: { cookie: `${DEV_COOKIE}=${invite}` } })))?.status).toBe(404);
  });
});

describe('/dev cookie is bound to the passphrase (T4.2.01a L1)', () => {
  const guard = (value: string) =>
    devGuard(
      new NextRequest(`${SITE}/dev/tick`, {
        method: 'POST',
        headers: { cookie: `${DEV_COOKIE}=${value}`, origin: SITE },
      }),
    );
  it('a cookie minted under another passphrase (i.e. before a rotation) is refused', async () => {
    const key = process.env.SESSION_SIGNING_SECRET!;
    const rotatedAway = signCookie('dev', passphraseTag('the-old-passphrase-before-rotation'), 3600, key);
    expect((await guard(rotatedAway))?.status).toBe(404);
    expect((await guard(signCookie('dev', 'dev', 3600, key)))?.status).toBe(404); // the old constant-value format
    expect(await guard(devCookieValue())).toBeNull();
  });
});

describe('photo sign in the prototype (T1.8.02, T3.6.02)', () => {
  const sign = () =>
    photoSign(new NextRequest(`${SITE}/api/photos/sign`, { method: 'POST', headers: { origin: SITE } }));
  it('without twj_req: 403', async () => {
    expect((await sign()).status).toBe(403);
  });
  const withReq = (requestId: string) =>
    jar.set('twj_req', signCookie('req', requestId, 3600, process.env.SESSION_SIGNING_SECRET!));
  it('with a valid twj_req for a request that no longer exists: 403', async () => {
    withReq('00000000-0000-0000-0000-000000000001');
    expect((await sign()).status).toBe(403);
  });
  it('with a valid twj_req: { mock: true } in the prototype, and nothing is stored (§5.5)', async () => {
    const [invite] = await q<{ id: string }>(`select id from invite where kind = 'general'`);
    const [slot] = await q<{ id: string }>(`select id from slot limit 1`);
    const body = RequestBody.parse({
      clientKey: randomUUID(),
      dish: 'the-long-lunch',
      name: 'Pia',
      email: `pia+${randomUUID().slice(0, 6)}@example.com`,
      crew: 1,
      slotIds: [slot!.id],
    });
    const { requestId } = await withTx((c) =>
      createRequestTx(c, {
        body,
        inviteId: invite!.id,
        isTest: true,
        spam: false,
        mode: 'slots',
        status: 'requested',
        countsToward: 'weekly_cap',
        bigCrew: false,
        dishName: 'The Long Lunch',
      }),
    );
    withReq(requestId);
    const res = await sign();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mock: true });
    expect(
      await q(`select 1 from photo_upload pu join story s on s.id = pu.story_id where s.request_id = $1`, [
        requestId,
      ]),
    ).toHaveLength(0);
  });
});
