// T2.1.04 + T2.1.06 (TSD T2.1 AC3, AC4, AC6, AC9) against the real test DB. The Supabase Auth client is a fake,
// so no email is sent and no real session is made; what's tested is our routing, checks and bookkeeping.
// Regression register: evals/bugs/signin-emails-per-address.json
// Regression register: evals/bugs/signin-wrong-code-count-race.json
// Regression register: evals/bugs/signin-link-drops-next.json
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { report } from '@/lib/report';
import { q } from '@/lib/db';
import { currentAuthEmail } from '@/features/admin/supabase';
import { SIGNIN_FAILED_KEY } from '@/features/admin/signin';
import { POST as verify } from '@/app/api/admin/auth/verify/route';
import { POST as signout } from '@/app/api/admin/auth/signout/route';
import { POST as confirm } from '@/app/api/admin/auth/confirm/route';
import ConfirmSignInPage from '@/app/admin/auth/callback/page';
import { signConfirm } from '@/app/admin/auth/confirm-token';
import { isKnownDevice, KNOWN_DEVICE_COOKIE } from '@/features/admin/known-device';

const auth = vi.hoisted(() => ({ verifyOtp: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/report', () => ({ report: vi.fn(), reportMessage: vi.fn() }));
vi.mock('@/features/admin/supabase', () => ({
  adminAuthClient: vi.fn(async () => ({ auth })),
  currentAuthEmail: vi.fn(),
}));

const ADMIN = 'jon@example.com'; // tests/setup-int.ts ADMIN_EMAILS
const SITE = 'http://localhost:3000';
const HASH = 'a'.repeat(56);
const session = (email: string) => ({
  data: { user: { email }, session: { access_token: 'x' } },
  error: null,
});
const refused = () => ({
  data: { user: null, session: null },
  error: new AuthApiError('Token has expired or is invalid', 403, 'otp_expired'),
});

const post = (handler: (r: NextRequest) => Promise<Response>, url: string, body: unknown, origin = SITE) =>
  handler(
    new NextRequest(`${SITE}${url}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
/** The A1c page for a link query: its hidden form fields, or 'not_found'. Rendering it must never call Auth. */
const openPage = async (query: string): Promise<Record<string, string> | 'not_found'> => {
  const sp: Record<string, string[]> = {};
  for (const [k, v] of new URLSearchParams(query)) (sp[k] ??= []).push(v);
  try {
    const tree = await ConfirmSignInPage({ searchParams: Promise.resolve(sp) });
    const fields: Record<string, string> = {};
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object' || !('props' in n)) return;
      const props = (n as { props: { type?: string; name?: string; value?: string; children?: unknown } })
        .props;
      if (props.type === 'hidden' && props.name) fields[props.name] = props.value ?? '';
      walk(props.children);
    };
    walk(tree);
    return fields;
  } catch (e) {
    if (String((e as { digest?: string }).digest ?? '').includes('404')) return 'not_found';
    throw e;
  }
};
/** "Sign me in": the form post, as the browser sends it. */
const tap = (fields: Record<string, string | string[]>, origin = SITE, query = '', cookie = '') => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) body.append(k, x);
  return confirm(
    new NextRequest(`${SITE}/api/admin/auth/confirm${query}`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/x-www-form-urlencoded',
        ...(cookie ? { cookie } : {}),
      },
      body: body.toString(),
    }),
  );
};
const link = (hash = HASH) => ({ token_hash: hash, csrf: signConfirm(hash) });
const bucket = async () =>
  (await q<{ n: number }>(`select count(*)::int as n from rate_limit where scope = 'adminSignInVerify'`))[0]!
    .n;
const location = (res: Response) => new URL(res.headers.get('location') ?? '').pathname;
const flag = async () =>
  (await q<{ value: string }>('select value from system_status where key = $1', [SIGNIN_FAILED_KEY]))[0]
    ?.value ?? null;

beforeEach(async () => {
  auth.verifyOtp.mockReset();
  auth.signOut.mockReset().mockResolvedValue({ error: null });
  vi.mocked(currentAuthEmail).mockReset();
  vi.mocked(report).mockReset();
  await q(`delete from rate_limit where scope in ('adminSignInVerify', 'adminSignInVerifyEmail')`);
  await q(
    `insert into system_status (key, value) values ($1, 'smtp')
     on conflict (key) do update set value = 'smtp'`,
    [SIGNIN_FAILED_KEY],
  );
});

describe('POST /api/admin/auth/verify (the 6-digit code, AC3)', () => {
  it('signs the admin in, and clears the failed-email flag (T2.1.09)', async () => {
    auth.verifyOtp.mockResolvedValue(session(ADMIN));
    const res = await post(verify, '/api/admin/auth/verify', { email: 'JON@example.com ', code: '123456' });
    expect(res.status).toBe(200);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: ADMIN, token: '123456', type: 'email' });
    expect(await flag()).toBeNull();
  });

  it('a wrong or used code: 400, and the flag stays', async () => {
    auth.verifyOtp.mockResolvedValue(refused());
    expect((await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '000000' })).status).toBe(400);
    expect(await flag()).toBe('smtp');
  });

  it('a verify that returns a user but no session is not a sign-in', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: { email: ADMIN }, session: null }, error: null });
    expect((await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '123456' })).status).toBe(400);
    expect(await flag()).toBe('smtp');
  });

  it('a verified user who is not on the allowlist gets 401 and no session', async () => {
    auth.verifyOtp.mockResolvedValue(session('someone@example.com'));
    const res = await post(verify, '/api/admin/auth/verify', {
      email: 'someone@example.com',
      code: '123456',
    });
    expect(res.status).toBe(401);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('refuses a malformed code, a foreign Origin, and an 11th try from one IP within the hour', async () => {
    for (const code of ['12345', '1234567', 'abcdef', 123456]) {
      expect((await post(verify, '/api/admin/auth/verify', { email: ADMIN, code })).status).toBe(400);
    }
    expect(
      (await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '1' }, 'https://evil.example'))
        .status,
    ).toBe(403);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    auth.verifyOtp.mockResolvedValue(refused());
    for (let i = 0; i < 10; i++)
      await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '000000' });
    expect((await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '000000' })).status).toBe(429);
    expect(auth.verifyOtp).toHaveBeenCalledTimes(10);
  });
});

describe('POST /api/admin/auth/verify: limits, caching and Sentry (review F1, L2)', () => {
  const clearIpBucket = () => q(`delete from rate_limit where scope = 'adminSignInVerify'`);

  const WRONG_CAP = 30; // LIMITS.adminSignInVerifyEmail

  it('after 30 WRONG codes at one address within the hour, the next try is a 429 from any IP, before any code check; other addresses are not', async () => {
    auth.verifyOtp.mockReset(); // no queued answer from an earlier test
    auth.verifyOtp.mockResolvedValue(refused());
    for (let i = 0; i < WRONG_CAP; i++) {
      if (i % 5 === 0) await clearIpBucket(); // spread over many IPs
      expect((await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '000000' })).status).toBe(
        400,
      );
    }
    await clearIpBucket(); // a new IP
    auth.verifyOtp.mockClear();
    auth.verifyOtp.mockResolvedValue(session(ADMIN)); // even a right code is not checked now
    const res = await post(verify, '/api/admin/auth/verify', {
      email: ` ${ADMIN.toUpperCase()}`,
      code: '123456',
    });
    expect(res.status).toBe(429);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    auth.verifyOtp.mockResolvedValue(refused());
    const other = await post(verify, '/api/admin/auth/verify', {
      email: 'other@example.com',
      code: '000000',
    });
    expect(other.status).toBe(400);
  });

  it("10 wrong codes for the admin's address from other IPs never refuse the admin's correct code (B007)", async () => {
    auth.verifyOtp.mockResolvedValue(refused());
    for (let i = 0; i < 10; i++) {
      await clearIpBucket(); // a different IP each time
      expect((await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '000000' })).status).toBe(
        400,
      );
    }
    await clearIpBucket(); // the admin, from a new IP
    auth.verifyOtp.mockResolvedValueOnce(session(ADMIN));
    const res = await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '123456' });
    expect(res.status).toBe(200);
  });

  it('a correct code does not count toward the per-address bucket (counted first, then given back)', async () => {
    auth.verifyOtp.mockResolvedValue(session(ADMIN));
    for (let i = 0; i < 3; i++)
      await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '123456' });
    const [row] = await q<{ n: number }>(
      `select coalesce(sum(count), 0)::int as n from rate_limit where scope = 'adminSignInVerifyEmail'`,
    );
    expect(row!.n).toBe(0);
  });

  it('a right code marks the browser as the known device; a wrong one does not', async () => {
    auth.verifyOtp.mockResolvedValueOnce(refused()).mockResolvedValueOnce(session(ADMIN));
    const wrong = await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '000000' });
    expect(wrong.headers.get('set-cookie') ?? '').not.toContain(KNOWN_DEVICE_COOKIE);
    const right = await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '123456' });
    const cookie = right.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${KNOWN_DEVICE_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(cookie).toMatch(/Path=\/api\/admin\/auth/i);
    expect(cookie).not.toContain('example.com'); // it names a hash of the address, never the address
    const value = cookie.split(';')[0]!.split('=').slice(1).join('=');
    expect(isKnownDevice(value, ADMIN)).toBe(true);
  });

  it('the rate_limit table holds no email address', async () => {
    auth.verifyOtp.mockResolvedValue(refused());
    await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '000000' });
    const rows = await q<{ key: string }>(
      `select key from rate_limit where scope = 'adminSignInVerifyEmail'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('every answer is no-store', async () => {
    auth.verifyOtp.mockResolvedValueOnce(session(ADMIN)).mockResolvedValue(refused());
    for (const body of [
      { email: ADMIN, code: '123456' },
      { email: ADMIN, code: '000000' },
      { email: ADMIN, code: 'x' },
    ]) {
      const res = await post(verify, '/api/admin/auth/verify', body);
      expect(res.headers.get('cache-control'), JSON.stringify(body)).toBe('no-store');
    }
  });

  it('Auth down (fetch error, 5xx) or its own 429 is reported; a wrong code is not', async () => {
    const failing = (error: Error) => ({ data: { user: null, session: null }, error });
    const cases: [Error, boolean][] = [
      [new AuthRetryableFetchError('fetch failed', 0), true],
      [new AuthApiError('boom', 500, 'unexpected_failure'), true],
      [new AuthApiError('slow down', 429, 'over_request_rate_limit'), true],
      [new AuthApiError('Token has expired or is invalid', 403, 'otp_expired'), false],
    ];
    for (const [error, reported] of cases) {
      vi.mocked(report).mockReset();
      await clearIpBucket();
      auth.verifyOtp.mockResolvedValue(failing(error));
      const res = await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '000000' });
      expect(res.status, error.message).toBe(400);
      expect(vi.mocked(report).mock.calls.length, error.message).toBe(reported ? 1 : 0);
    }
  });
});

describe('the emailed link: GET /admin/auth/callback = the A1c page (no side effects), AC3/AC4', () => {
  it('a valid link renders the one-tap form: its token_hash and a CSRF token for that link; no Auth call, no bucket', async () => {
    const fields = await openPage(`token_hash=${HASH}&type=email`);
    expect(fields).toEqual({ token_hash: HASH, csrf: expect.stringMatching(/^\d+\.[A-Za-z0-9_-]{43}$/) });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(await bucket()).toBe(0);
  });

  it('link scanners, prefetches and HEADs can open it any number of times: the token stays unspent', async () => {
    // Next answers HEAD and prefetches by rendering the same page; the page reads no headers and calls nothing.
    for (let i = 0; i < 20; i++)
      expect(await openPage(`token_hash=${HASH}&type=email`)).not.toBe('not_found');
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(await bucket()).toBe(0);
    auth.verifyOtp.mockResolvedValue(session(ADMIN));
    expect(location(await tap(link()))).toBe('/admin'); // still good for the real tap
  });

  it('the type must be exactly "email", and the hash well formed: otherwise a 404 and no call at all', async () => {
    for (const query of [
      `token_hash=${HASH}&type=magiclink`,
      `token_hash=${HASH}&type=signup`,
      `token_hash=${HASH}&type=recovery`,
      `token_hash=${HASH}&type=EMAIL`,
      `token_hash=${HASH}&type=Email`,
      `token_hash=${HASH}&type=invite`,
      `token_hash=${HASH}&type=email_change`,
      `token_hash=${HASH}&type=email&type=recovery`,
      `token_hash=${HASH}&token_hash=${HASH}&type=email`,
      `token_hash=${HASH}`,
      `token_hash=${HASH.slice(1)}&type=email`,
      `token_hash=${HASH.toUpperCase()}&type=email`,
      'type=email',
    ]) {
      expect(await openPage(query), query).toBe('not_found');
    }
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/auth/confirm ("Sign me in" on A1c), AC3/AC4', () => {
  it('signs in with verifyOtp (type email, once) and lands on /admin with a 303', async () => {
    auth.verifyOtp.mockResolvedValue(session(ADMIN));
    const res = await tap(link());
    expect(res.status).toBe(303);
    expect(location(res)).toBe('/admin');
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: 'email' });
    expect(await flag()).toBeNull();
  });

  it('a link sign-in marks the browser as the known device; a failed one does not', async () => {
    auth.verifyOtp.mockResolvedValueOnce(refused()).mockResolvedValueOnce(session(ADMIN));
    expect((await tap(link())).headers.get('set-cookie') ?? '').not.toContain(KNOWN_DEVICE_COOKIE);
    const cookie = (await tap(link())).headers.get('set-cookie') ?? '';
    const value = cookie.split(';')[0]!.split('=').slice(1).join('=');
    expect(cookie).toContain(`${KNOWN_DEVICE_COOKIE}=`);
    expect(isKnownDevice(value, ADMIN)).toBe(true);
  it('EML-11: returns to the admin page this browser kept when it asked for the email, and uses it once', async () => {
    auth.verifyOtp.mockResolvedValue(session(ADMIN));
    const page = '/admin/requests/11111111-1111-4111-8111-111111111111?tab=x';
    const res = await tap(link(), SITE, '', `twj_admin_next=${encodeURIComponent(page)}`);
    expect(res.status).toBe(303);
    expect(
      new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search,
    ).toBe(page);
    expect(res.headers.get('set-cookie') ?? '').toMatch(/twj_admin_next=;.*Max-Age=0/i);
  });

  it.each(['//evil.example', 'https://evil.example/admin', '/admin//sign-in', '/menu'])(
    'EML-11: a kept page of %j is never followed: the inbox',
    async (planted) => {
      auth.verifyOtp.mockResolvedValue(session(ADMIN));
      const res = await tap(link(), SITE, '', `twj_admin_next=${encodeURIComponent(planted)}`);
      expect(location(res)).toBe('/admin');
      expect(new URL(res.headers.get('location')!).origin).toBe(SITE);
    },
  );

  it('EML-11: a failed link keeps nothing and goes to the sign-in failure, never the kept page', async () => {
    auth.verifyOtp.mockResolvedValue(refused());
    const res = await tap(link(), SITE, '', `twj_admin_next=${encodeURIComponent('/admin/stories')}`);
    expect(location(res)).not.toBe('/admin/stories');
  });

  it('always lands on a fixed /admin: next, redirect_to and redirect are ignored (no open redirect)', async () => {
    auth.verifyOtp.mockResolvedValue(session(ADMIN));
    for (const target of [
      '//evil.example/admin',
      'https://evil.example',
      '/\\evil.example',
      '/admin/requests/7',
    ]) {
      for (const key of ['next', 'redirect_to', 'redirect']) {
        await q(`delete from rate_limit where scope = 'adminSignInVerify'`);
        const res = await tap({ ...link(), [key]: target });
        expect(res.status, `${key}=${target}`).toBe(303);
        expect(res.headers.get('location'), `${key}=${target}`).toBe(`${SITE}/admin`);
      }
    }
    // pr75-review F2: in the POST's query string too (a route reading req.nextUrl.searchParams would fail here).
    await q(`delete from rate_limit where scope = 'adminSignInVerify'`);
    const viaQuery = await tap(
      link(),
      SITE,
      '?next=//evil.example&redirect_to=https://evil.example&redirect=/%5Cevil.example',
    );
    expect(viaQuery.status).toBe(303);
    expect(viaQuery.headers.get('location')).toBe(`${SITE}/admin`);
  });

  it('refuses a foreign or missing Origin (403) and a missing, forged, expired or other-link CSRF token (403), before any Auth call', async () => {
    expect((await tap(link(), 'https://evil.example')).status).toBe(403);
    expect((await tap(link(), 'null')).status).toBe(403);
    const other = 'b'.repeat(56);
    const expired = signConfirm(HASH, Date.now() - 901_000);
    for (const csrf of [signConfirm(other), expired, `1.${'A'.repeat(43)}`, 'x']) {
      expect((await tap({ token_hash: HASH, csrf })).status, csrf).toBe(403);
    }
    expect((await tap({ token_hash: HASH })).status).toBe(400);
    expect((await tap({ token_hash: [HASH, HASH], csrf: signConfirm(HASH) })).status).toBe(400);
    expect((await tap({ token_hash: 'zz', csrf: 'x' })).status).toBe(400);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(await bucket()).toBe(0);
  });

  it('one use only: a replay of a spent link fails cleanly back to sign-in (error=link)', async () => {
    auth.verifyOtp.mockResolvedValueOnce(session(ADMIN)).mockResolvedValueOnce(refused());
    const fields = link();
    expect(location(await tap(fields))).toBe('/admin');
    const again = await tap(fields);
    expect(again.status).toBe(303);
    expect(location(again)).toBe('/admin/sign-in');
    expect(new URL(again.headers.get('location')!).searchParams.get('error')).toBe('link');
  });

  it('a verified user who is not on the allowlist: 401, the session dropped, the flag kept', async () => {
    auth.verifyOtp.mockResolvedValue(session('someone@example.com'));
    const res = await tap(link());
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await flag()).toBe('smtp');
  });

  it('shares the code route’s per-IP bucket: the 11th goes to sign-in with no Auth call (review F2)', async () => {
    auth.verifyOtp.mockResolvedValue(refused());
    for (let i = 0; i < 5; i++)
      await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '000000' });
    for (let i = 0; i < 5; i++) await tap(link());
    expect(auth.verifyOtp).toHaveBeenCalledTimes(10);
    const res = await tap(link());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${SITE}/admin/sign-in?error=link`);
    expect((await post(verify, '/api/admin/auth/verify', { email: ADMIN, code: '000000' })).status).toBe(429);
    expect(auth.verifyOtp).toHaveBeenCalledTimes(10);
  });

  it('nothing is cached, and no answer or report carries the token', async () => {
    auth.verifyOtp
      .mockResolvedValueOnce(session(ADMIN))
      .mockResolvedValueOnce(refused())
      .mockRejectedValueOnce(new AuthRetryableFetchError('down', 0));
    const answers = [
      await tap(link()),
      await tap(link()),
      await tap(link(), 'https://evil.example'),
      await tap({ token_hash: HASH, csrf: 'x' }),
      await tap({ token_hash: 'zz', csrf: 'x' }),
    ];
    for (const res of answers) {
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('location') ?? '').not.toContain(HASH);
      expect(await res.text()).not.toContain(HASH);
    }
    for (const call of vi.mocked(report).mock.calls) expect(JSON.stringify(call)).not.toContain(HASH);
  });
});

describe('POST /api/admin/auth/signout (T2.1.06, AC6)', () => {
  it('ends every session (scope global) and goes to the sign-in page', async () => {
    vi.mocked(currentAuthEmail).mockResolvedValue(ADMIN);
    const res = await post(signout, '/api/admin/auth/signout', {});
    expect(res.status).toBe(303);
    expect(location(res)).toBe('/admin/sign-in');
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'global' });
  });

  it('if the global sign-out fails: 502, and this browser is still signed out', async () => {
    vi.mocked(currentAuthEmail).mockResolvedValue(ADMIN);
    auth.signOut.mockResolvedValueOnce({ error: new AuthApiError('boom', 500, 'unexpected_failure') });
    const res = await post(signout, '/api/admin/auth/signout', {});
    expect(res.status).toBe(502);
    expect(auth.signOut).toHaveBeenLastCalledWith({ scope: 'local' });
  });

  it('needs an admin session and our Origin', async () => {
    vi.mocked(currentAuthEmail).mockResolvedValue(null);
    expect((await post(signout, '/api/admin/auth/signout', {})).status).toBe(401);
    vi.mocked(currentAuthEmail).mockResolvedValue(ADMIN);
    expect((await post(signout, '/api/admin/auth/signout', {}, 'https://evil.example')).status).toBe(403);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

// ops/end-admin-sessions.sql needs Supabase's auth schema: it runs in the CI job on Supabase's own Postgres and
// is skipped on the plain PG15 test database.
const hasAuth = Boolean(
  (await q<{ ok: boolean }>(`select to_regclass('auth.sessions') is not null as ok`))[0]?.ok,
);
describe.skipIf(!hasAuth)('ops/end-admin-sessions.sql (T2.1.06, review F11)', () => {
  const script = path.resolve(__dirname, '../../ops/end-admin-sessions.sql');
  const psql = (...vars: string[]) =>
    spawnSync('psql', [process.env.DATABASE_URL!, '-X', '-q', ...vars, '-f', script], { encoding: 'utf8' });

  it('deletes the admins’ sessions and refresh tokens, and nobody else’s', async () => {
    const [admin, other] = [randomUUID(), randomUUID()];
    const [adminEmail, otherEmail] = [`admin-${admin}@example.com`, `other-${other}@example.com`];
    await q(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`, [
      admin,
      adminEmail,
      other,
      otherEmail,
    ]);
    const sessions = [randomUUID(), randomUUID(), randomUUID()];
    await q(`insert into auth.sessions (id, user_id) values ($1, $4), ($2, $4), ($3, $5)`, [
      ...sessions,
      admin,
      other,
    ]);
    await q(
      `insert into auth.refresh_tokens (token, user_id, session_id) values ('t1', $1, $2), ('t2', $3, $4)`,
      [admin, sessions[0], other, sessions[2]],
    );
    try {
      // pr26-review R3: one typo in the list ends nothing and exits non-zero.
      const typo = psql('-v', `admin_emails=${adminEmail}, nobody-${randomUUID()}@example.com`);
      expect(typo.status).not.toBe(0);
      expect(typo.stderr).toMatch(/not every admin_emails address matched/);
      expect(await q(`select 1 from auth.sessions where user_id = $1`, [admin])).toHaveLength(2);
      // Case, blanks and a repeated entry are fine.
      const run = psql('-v', `admin_emails=${adminEmail.toUpperCase()}, ,${adminEmail}`);
      expect(run.status, run.stderr).toBe(0);
      const left = await q<{ user_id: string }>(
        `select user_id::text from auth.sessions where user_id in ($1, $2)`,
        [admin, other],
      );
      expect(left.map((r) => r.user_id)).toEqual([other]);
      const tokens = await q<{ token: string }>(
        `select token from auth.refresh_tokens where token in ('t1', 't2')`,
      );
      expect(tokens.map((r) => r.token)).toEqual(['t2']);
    } finally {
      await q(`delete from auth.users where id in ($1, $2)`, [admin, other]);
    }
  });

  it('fails loudly when no admin user matches (review L3), and tabs or newlines around an address are fine', async () => {
    const run = psql('-v', `admin_emails=nobody-${randomUUID()}@example.com`);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/not every admin_emails address matched/);
    const id = randomUUID();
    const email = `admin-${id}@example.com`;
    await q(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
    try {
      const ok = psql('-v', `admin_emails=\t${email}\n`);
      expect(ok.status, ok.stderr).toBe(0);
    } finally {
      await q(`delete from auth.users where id = $1`, [id]);
    }
  });

  it('refuses to run without admin_emails', () => {
    const run = psql();
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/usage/);
  });
});
