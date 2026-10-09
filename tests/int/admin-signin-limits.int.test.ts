// Admin sign-in limits, both halves each: the admin is never refused, and the misuse is capped.
// 1. Sign-in emails per address: a start from any browser but the admin's known device counts against a per-address
//    limit (3 an hour) and stops short of the sign-in emails kept for the known device, so a burst of starts for the
//    admin address from many IPs can't use up the day; the known device's start still sends.
// 2. Wrong codes per address: counted first and given back when right, so codes sent at once can't all be checked.
// Supabase is mocked (nothing is sent). The client IP comes from x-forwarded-for, as on Vercel.
// Regression register: evals/bugs/signin-emails-per-address.json
// Regression register: evals/bugs/signin-wrong-code-count-race.json
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthApiError } from '@supabase/supabase-js';
import { q } from '@/lib/db';
import { sendOtpEmail } from '@/features/admin/supabase';
import { sendAdminSignIn } from '@/features/admin/signin';
import { addressKey, isKnownDevice, KNOWN_DEVICE_COOKIE } from '@/features/admin/known-device';
import { SIGNIN_CAP, SIGNIN_KNOWN_DEVICE_RESERVE } from '@/features/email/budget';
import { signCookie } from '@/features/invites/tokens';
import { LIMITS } from '@/lib/ratelimit';
import { POST as start } from '@/app/api/admin/auth/start/route';
import { POST as verify } from '@/app/api/admin/auth/verify/route';

const pending = vi.hoisted(() => [] as (() => Promise<void>)[]);
const auth = vi.hoisted(() => ({ verifyOtp: vi.fn(), signOut: vi.fn() }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => void pending.push(task),
}));
vi.mock('@/features/admin/supabase', () => ({
  sendOtpEmail: vi.fn(),
  adminAuthClient: vi.fn(async () => ({ auth })),
  currentAuthEmail: vi.fn(),
}));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: vi.fn(async () => true) }));
vi.mock('@/lib/http', async (orig) => {
  const real = await orig<typeof import('@/lib/http')>();
  return { ...real, clientIp: (req: NextRequest) => real.clientIpFrom(req.headers, true) };
});

const otp = vi.mocked(sendOtpEmail);
const ADMIN = 'jon@example.com'; // tests/setup-int.ts ADMIN_EMAILS
const SITE = 'http://localhost:3000';
const SECRET = 'test-session-secret-test-session-secret-01'; // tests/setup-int.ts
const knownCookie = (email = ADMIN) => signCookie('device', addressKey(email), 3600, SECRET);

const startFrom = (ip: string, email = ADMIN, cookie?: string) =>
  start(
    new NextRequest(`${SITE}/api/admin/auth/start`, {
      method: 'POST',
      headers: {
        origin: SITE,
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        ...(cookie ? { cookie: `${KNOWN_DEVICE_COOKIE}=${cookie}` } : {}),
      },
      body: JSON.stringify({ email, turnstileToken: 'ok' }),
    }),
  );
const verifyFrom = (ip: string, code: string, email = ADMIN) =>
  verify(
    new NextRequest(`${SITE}/api/admin/auth/verify`, {
      method: 'POST',
      headers: { origin: SITE, 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email, code }),
    }),
  );
async function runPending() {
  const tasks = pending.splice(0);
  await Promise.all(tasks.map((t) => t()));
}
const signinToday = async () =>
  (
    await q<{ n: number }>(
      `select coalesce(sum(signin_count), 0)::int as n from email_budget where utc_day = (now() at time zone 'utc')::date`,
    )
  )[0]!.n;
const ip = (i: number) => `203.0.113.${i + 1}`;

beforeEach(async () => {
  pending.length = 0;
  otp.mockReset().mockResolvedValue({ error: null });
  auth.verifyOtp.mockReset();
  auth.signOut.mockReset().mockResolvedValue({ error: null });
  await q('delete from email_budget');
  await q(`delete from rate_limit where scope like 'adminSignIn%'`);
});

describe('sign-in emails per address', () => {
  it('a 9-IP burst of starts for the admin address cannot block the known device: its start still sends', async () => {
    for (let i = 0; i < 9; i++) {
      const res = await startFrom(ip(i));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true }); // the same answer as for anyone
    }
    await runPending();
    // At most the per-address limit got as far as the budget, and never into the kept slots.
    expect(otp.mock.calls.length).toBeLessThanOrEqual(LIMITS.adminSignInStartEmail.limit);
    expect(await signinToday()).toBeLessThanOrEqual(
      SIGNIN_CAP.prototype - SIGNIN_KNOWN_DEVICE_RESERVE.prototype,
    );
    otp.mockClear();
    const jon = await startFrom(ip(50), ADMIN, knownCookie());
    expect(jon.status).toBe(200);
    await runPending();
    expect(otp).toHaveBeenCalledExactlyOnceWith(ADMIN);
  });

  it('production: other browsers stop at 6 of the 8 a day; the known device gets the 2 kept for it', async () => {
    const unknown: string[] = [];
    for (let hour = 0; hour < 4; hour++) {
      await q(`delete from rate_limit where scope = 'adminSignInStartEmail'`); // a new hour
      for (let i = 0; i < 3; i++) unknown.push(await sendAdminSignIn(ADMIN, 'production', false));
    }
    expect(unknown.filter((o) => o === 'sent')).toHaveLength(
      SIGNIN_CAP.production - SIGNIN_KNOWN_DEVICE_RESERVE.production,
    );
    expect(await sendAdminSignIn(ADMIN, 'production', true)).toBe('sent');
    expect(await sendAdminSignIn(ADMIN, 'production', true)).toBe('sent');
    expect(await sendAdminSignIn(ADMIN, 'production', true)).toBe('capped'); // the day's cap still holds
    expect(await signinToday()).toBe(SIGNIN_CAP.production);
  });

  it('the 4th start from an unknown browser within the hour sends nothing; the known device is not counted', async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i++) outcomes.push(await sendAdminSignIn(ADMIN, 'production', false));
    expect(outcomes).toEqual(['sent', 'sent', 'sent', 'limited']);
    expect(await sendAdminSignIn(ADMIN, 'production', true)).toBe('sent');
    const [row] = await q<{ n: number }>(
      `select coalesce(sum(count), 0)::int as n from rate_limit where scope = 'adminSignInStartEmail'`,
    );
    expect(row!.n).toBe(4);
  });

  it('a stranger address never touches the limiter, and the limiter holds only a hash', async () => {
    expect(await sendAdminSignIn('stranger@example.com', 'production', false)).toBe('not_allowlisted');
    expect(await q(`select 1 from rate_limit where scope = 'adminSignInStartEmail'`)).toHaveLength(0);
    await sendAdminSignIn(ADMIN, 'production', false);
    const rows = await q<{ key: string }>(`select key from rate_limit where scope = 'adminSignInStartEmail'`);
    expect(rows).toEqual([{ key: addressKey(ADMIN) }]);
    expect(rows[0]!.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a supabase refusal still gives the slot back for an unknown browser (no change)', async () => {
    otp.mockResolvedValue({ error: new AuthApiError('wait 60 seconds', 429, 'over_email_send_rate_limit') });
    expect(await sendAdminSignIn(ADMIN, 'production', false)).toBe('refused');
    expect(await signinToday()).toBe(0);
  });

  it.each([
    ['another address', () => knownCookie('someone@example.com')],
    ['an expired cookie', () => signCookie('device', addressKey(ADMIN), -1, SECRET)],
    ['another purpose', () => signCookie('invite', addressKey(ADMIN), 3600, SECRET)],
    ['a forged one', () => `${addressKey(ADMIN)}.9999999999.AAAA`],
  ])('a known-device cookie for %s is not the known device', (_name, make) => {
    expect(isKnownDevice(make(), ADMIN)).toBe(false);
  });
});

describe('wrong codes per address: counted first, given back when right', () => {
  const refused = () => ({
    data: { user: null, session: null },
    error: new AuthApiError('Token has expired or is invalid', 403, 'otp_expired'),
  });
  const session = (email: string) => ({
    data: { user: { email }, session: { access_token: 'x' } },
    error: null,
  });

  it('40 wrong codes at once from 40 IPs: at most 30 are checked, the rest get a 429', async () => {
    auth.verifyOtp.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20)); // all 40 are in flight together
      return refused();
    });
    const answers = await Promise.all(Array.from({ length: 40 }, (_, i) => verifyFrom(ip(i), '000000')));
    const statuses = answers.map((r) => r.status);
    expect(auth.verifyOtp.mock.calls.length).toBeLessThanOrEqual(LIMITS.adminSignInVerifyEmail.limit);
    expect(statuses.filter((s) => s === 400)).toHaveLength(auth.verifyOtp.mock.calls.length);
    expect(statuses.filter((s) => s === 429)).toHaveLength(40 - auth.verifyOtp.mock.calls.length);
  });

  it("29 wrong codes, then the admin's right code from a new IP: 200, and the right code is not counted", async () => {
    auth.verifyOtp.mockResolvedValue(refused());
    for (let i = 0; i < 29; i++) expect((await verifyFrom(ip(i % 9), '000000')).status).toBe(400);
    auth.verifyOtp.mockResolvedValue(session(ADMIN));
    expect((await verifyFrom(ip(60), '123456')).status).toBe(200);
    const [row] = await q<{ n: number }>(
      `select coalesce(sum(count), 0)::int as n from rate_limit where scope = 'adminSignInVerifyEmail'`,
    );
    expect(row!.n).toBe(29);
  });
});
