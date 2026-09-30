// T3.3.03–.06 (TSD T3.3 AC2–AC5): Connect, callback, Disconnect and Reconnect against the real test DB and a
// fake Google (tests/fixtures/fake-google.ts). No network call is ever made.
import '../fixtures/google-env';
import {
  TEST_CLIENT_ID,
  TEST_ENC_KEY,
  TEST_ENC_KEY_OLD,
  G3,
  fakeGoogle,
  idToken,
} from '../fixtures/fake-google';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { encryptWith, decryptToken } from '@/features/calendar/crypto';
import {
  gmailSendGranted,
  googleAccessToken,
  resetAccessTokenCacheForTests,
} from '@/features/calendar/connection';
import { getEnv } from '@/config/env';
import { GMAIL_SEND_SCOPE } from '@/lib/adapters/google/oauth';
import { GET as connect } from '@/app/api/admin/google/connect/route';
import { GET as callback } from '@/app/api/admin/google/callback/route';
import { POST as disconnect } from '@/app/api/admin/google/disconnect/route';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
let google: ReturnType<typeof fakeGoogle>;

async function row() {
  const rows = await q<{
    account_email: string;
    refresh_token_enc: Buffer | null;
    scopes: string[];
    calendar_id: string | null;
    last_error: string | null;
    last_ok_at: Date | null;
  }>(`select * from oauth_connection where provider = 'google'`);
  return rows[0] ?? null;
}

/** Runs connect → Google → callback; `tamper` edits the callback query before it is sent. */
async function connectFlow(tamper?: (params: URLSearchParams) => void, cookieOverride?: string) {
  const start = await connect(new NextRequest(`${SITE}/api/admin/google/connect`));
  expect(start.status).toBe(303);
  const consent = new URL(start.headers.get('location') ?? '');
  const cookie = /twj_gstate=([^;]+)/.exec(start.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const params = new URLSearchParams({ state: consent.searchParams.get('state') ?? '', code: 'the-code' });
  tamper?.(params);
  const res = await callback(
    new NextRequest(`${SITE}/api/admin/google/callback?${params}`, {
      headers: { cookie: `twj_gstate=${cookieOverride ?? cookie}` },
    }),
  );
  expect(res.status).toBe(303);
  return {
    consent,
    cookie,
    result: new URL(res.headers.get('location') ?? '').searchParams.get('google'),
    res,
  };
}

/** Runs `fn` with a cached-env field changed, then restores it (getEnv() caches one parsed object). */
async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const env = getEnv() as unknown as Record<string, string | undefined>;
  const old = Object.fromEntries(Object.keys(patch).map((k) => [k, env[k]]));
  Object.assign(env, patch);
  try {
    return await fn();
  } finally {
    Object.assign(env, old);
  }
}

const calendarInserts = () =>
  google.calls.filter((c) => c.method === 'POST' && c.url.pathname === '/calendar/v3/calendars').length;
const revokes = () =>
  google.calls
    .filter((c) => c.url.pathname === '/revoke')
    .map((c) => new URLSearchParams(c.body).get('token'));

beforeEach(async () => {
  google = fakeGoogle();
  vi.stubGlobal('fetch', google.fetch);
  resetAccessTokenCacheForTests();
  await q('delete from oauth_connection');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/admin/google/connect (T3.3.03)', () => {
  it('sends Jon to Google with the G3 scopes, offline, consent, state and PKCE, and a callback-scoped cookie', async () => {
    const { consent, cookie, res } = await connectFlow();
    expect(consent.origin + consent.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const p = consent.searchParams;
    expect(p.get('scope')?.split(' ')).toEqual(G3);
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('prompt')).toBe('consent');
    expect(p.get('client_id')).toBe(TEST_CLIENT_ID);
    expect(p.get('redirect_uri')).toBe(`${SITE}/api/admin/google/callback`);
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('login_hint')).toBe('jon@example.com');
    expect(cookie.startsWith(`${p.get('state')}.`)).toBe(true);
    // the callback clears the one-time cookie
    expect(res.headers.get('set-cookie')).toMatch(/twj_gstate=;.*Max-Age=0/i);
  });

  it('sets the state cookie httpOnly, Secure, Lax, scoped to the callback, 10 minutes', async () => {
    const res = await connect(new NextRequest(`${SITE}/api/admin/google/connect`));
    const sc = res.headers.get('set-cookie') ?? '';
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=lax/i);
    expect(sc).toMatch(/Path=\/api\/admin\/google\/callback/);
    expect(sc).toMatch(/Max-Age=600/);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('GET /api/admin/google/callback (T3.3.04, T3.3.06)', () => {
  it('AC2: creates "Time with Jon (test)" in America/Vancouver and stores the token encrypted', async () => {
    const { result } = await connectFlow();
    expect(result).toBe('connected');
    const r = await row();
    expect(r?.account_email).toBe('jon@example.com');
    expect(r?.calendar_id).toBe('cal1@group.calendar.google.com');
    expect([...google.calendars.values()]).toEqual([
      { summary: 'Time with Jon (test)', timeZone: 'America/Vancouver' },
    ]);
    expect(r?.scopes).toEqual(G3);
    expect(r?.refresh_token_enc?.includes(Buffer.from('refresh-1'))).toBe(false);
    expect(decryptToken(r!.refresh_token_enc!)).toEqual({ plain: 'refresh-1', stale: false });
    // the code went to Google with the PKCE verifier from the cookie
    const exchange = google.calls.find((c) => c.url.pathname === '/token');
    expect(new URLSearchParams(exchange?.body).get('code')).toBe('the-code');
    expect(new URLSearchParams(exchange?.body).get('code_verifier')).toMatch(/^[\w-]{43}$/);
  });

  it('AC3: a foreign Google account is refused, its grant revoked, nothing stored', async () => {
    google.state.account = 'someone-else@example.com';
    const { result } = await connectFlow();
    expect(result).toBe('foreign_account');
    expect(await row()).toBeNull();
    expect(calendarInserts()).toBe(0);
    expect(revokes()).toEqual(['refresh-1']);
  });

  it('AC3: an unverified email or a token for another client counts as foreign', async () => {
    const tokenWith = (claims: Record<string, unknown>) => (c: { url: URL }) =>
      c.url.pathname === '/token'
        ? {
            status: 200,
            json: { access_token: 'a', refresh_token: 'r', scope: G3.join(' '), id_token: idToken(claims) },
          }
        : undefined;
    for (const claims of [
      { email: 'jon@example.com', aud: 'other-client' },
      { email: 'jon@example.com', email_verified: false },
      { email: 'jon@example.com', iss: 'https://evil.example' },
      { email: 42 },
    ]) {
      google.state.overrides = [tokenWith(claims)];
      expect((await connectFlow()).result).toBe('foreign_account');
    }
    google.state.overrides = [
      (c) =>
        c.url.pathname === '/token'
          ? { status: 200, json: { access_token: 'a', refresh_token: 'r', scope: G3.join(' ') } }
          : undefined,
    ];
    expect((await connectFlow()).result).toBe('foreign_account');
    expect(await row()).toBeNull();
  });

  it('AC5: the granted scopes must equal the G3 set exactly (a missing or an extra scope is refused)', async () => {
    google.state.scopes = G3.filter((s) => !s.endsWith('calendar.freebusy'));
    expect((await connectFlow()).result).toBe('scopes');
    google.state.scopes = [...G3, 'https://www.googleapis.com/auth/calendar'];
    expect((await connectFlow()).result).toBe('scopes');
    expect(await row()).toBeNull();
    expect(calendarInserts()).toBe(0);
    expect(revokes()).toHaveLength(2);
  });

  it('refuses a grant with no refresh token (offline access not given)', async () => {
    google.state.refreshToken = null;
    expect((await connectFlow()).result).toBe('no_refresh_token');
    expect(await row()).toBeNull();
    expect(revokes()).toEqual(['access-1']); // the access-only grant is revoked too
  });

  it('refuses a wrong, missing or repeated state before calling Google', async () => {
    expect((await connectFlow((p) => p.set('state', 'forged'))).result).toBe('expired');
    expect((await connectFlow((p) => p.append('state', 'forged'))).result).toBe('expired');
    expect((await connectFlow(undefined, '')).result).toBe('expired');
    expect(google.calls.filter((c) => c.url.pathname === '/token')).toHaveLength(0);
    expect(await row()).toBeNull();
  });

  it('pr35 F7: a same-length state with one character flipped is refused (the constant-time compare runs)', async () => {
    const { result } = await connectFlow((p) => {
      const st = p.get('state') ?? '';
      p.set('state', (st[0] === 'A' ? 'B' : 'A') + st.slice(1));
    });
    expect(result).toBe('expired');
    expect(google.calls.filter((c) => c.url.pathname === '/token')).toHaveLength(0);
  });

  it('pr35 F1: a refused reconnect for Jon’s own account marks the stored grant dead (Google revoked all of it)', async () => {
    await connectFlow();
    await googleAccessToken(); // warm the cache
    google.state.refreshToken = 'refresh-2';
    google.state.scopes = G3.filter((s) => !s.endsWith('calendar.freebusy'));
    expect((await connectFlow()).result).toBe('scopes');
    let r = await row();
    expect(r?.refresh_token_enc).toBeNull();
    expect(r?.last_error).toBe('disconnected');
    expect(r?.calendar_id).toBe('cal1@group.calendar.google.com');
    await expect(googleAccessToken()).rejects.toThrow(/not connected/); // the cache went too

    google.state.scopes = [...G3];
    await connectFlow();
    google.state.refreshToken = null;
    expect((await connectFlow()).result).toBe('no_refresh_token');
    r = await row();
    expect(r?.refresh_token_enc).toBeNull();
    expect(r?.last_error).toBe('disconnected');
    expect(calendarInserts()).toBe(1);
  });

  it('pr35 F1: a foreign account refused on a reconnect leaves Jon’s stored grant alone', async () => {
    await connectFlow();
    google.state.account = 'someone-else@example.com';
    google.state.refreshToken = 'refresh-foreign';
    expect((await connectFlow()).result).toBe('foreign_account');
    const r = await row();
    expect(decryptToken(r!.refresh_token_enc!).plain).toBe('refresh-1');
    expect(r?.last_error).toBeNull();
  });

  it('pr35 F3a: a new calendar is stored before anything else can fail, so a retry reuses it', async () => {
    await withEnv({ GOOGLE_TOKEN_ENC_KEY: 'not-a-key' }, async () => {
      expect((await connectFlow()).result).toBe('failed'); // encryptToken throws after the calendar insert
    });
    let r = await row();
    expect(r?.calendar_id).toBe('cal1@group.calendar.google.com');
    expect(r?.refresh_token_enc).toBeNull();
    expect(r?.last_error).toBe('disconnected');
    expect((await connectFlow()).result).toBe('connected');
    expect(calendarInserts()).toBe(1);
    r = await row();
    expect(r?.calendar_id).toBe('cal1@group.calendar.google.com');
    expect(r?.last_error).toBeNull();
  });

  it('pr35 F3b: a calendar stored for another account is not probed; the new account gets its own', async () => {
    await q(
      `insert into oauth_connection (provider, account_email, refresh_token_enc, scopes, calendar_id)
       values ('google', 'old.test@example.com', null, '{}', 'theirs@group.calendar.google.com')`,
    );
    expect((await connectFlow()).result).toBe('connected');
    expect(google.calls.some((c) => c.url.pathname.includes('theirs'))).toBe(false);
    const r = await row();
    expect(r?.account_email).toBe('jon@example.com');
    expect(r?.calendar_id).toBe('cal1@group.calendar.google.com');
  });

  it('pr35 F4: never stores "primary" as the calendar id', async () => {
    google.state.overrides.push((c) =>
      c.method === 'POST' && c.url.pathname === '/calendar/v3/calendars'
        ? { status: 200, json: { id: 'primary' } }
        : undefined,
    );
    expect((await connectFlow()).result).toBe('failed');
    expect(await row()).toBeNull();
  });

  it('pr36 F1: GOOGLE_GMAIL_SEND=1 asks for and accepts exactly G3 + gmail.send; gmailSendGranted() says so', async () => {
    await withEnv({ GOOGLE_GMAIL_SEND: '1' }, async () => {
      google.state.scopes = [...G3, GMAIL_SEND_SCOPE];
      const { consent, result } = await connectFlow();
      expect(consent.searchParams.get('scope')?.split(' ')).toEqual([...G3, GMAIL_SEND_SCOPE]);
      expect(result).toBe('connected');
      expect((await row())?.scopes).toEqual([...G3, GMAIL_SEND_SCOPE]);
      expect(await gmailSendGranted()).toBe(true);
      google.state.scopes = [...G3]; // gmail.send unticked on consent: refused like any other missing scope
      expect((await connectFlow()).result).toBe('scopes');
      expect(await gmailSendGranted()).toBe(false); // the grant is dead, so the mailer fails closed
    });
  });

  it('pr36 F1: without the flag, gmail.send is neither asked for nor accepted; G3 alone never sends mail', async () => {
    expect(await gmailSendGranted()).toBe(false); // nothing connected
    const { consent } = await connectFlow();
    expect(consent.searchParams.get('scope')?.split(' ')).toEqual(G3);
    expect(await gmailSendGranted()).toBe(false);
    google.state.scopes = [...G3, GMAIL_SEND_SCOPE];
    expect((await connectFlow()).result).toBe('scopes');
  });

  it('Jon pressing Cancel on Google lands on A7 as cancelled; a missing code as failed', async () => {
    expect((await connectFlow((p) => (p.delete('code'), p.set('error', 'access_denied')))).result).toBe(
      'cancelled',
    );
    expect((await connectFlow((p) => p.delete('code'))).result).toBe('failed');
    expect(await row()).toBeNull();
  });

  it('a Google outage during the exchange lands as failed and stores nothing', async () => {
    google.state.overrides.push((c) => (c.url.pathname === '/token' ? { status: 503 } : undefined));
    expect((await connectFlow()).result).toBe('failed');
    expect(await row()).toBeNull();
  });

  it('AC4: reconnecting reuses the stored calendar (no second "Time with Jon")', async () => {
    await connectFlow();
    google.state.refreshToken = 'refresh-2';
    expect((await connectFlow()).result).toBe('connected');
    expect(calendarInserts()).toBe(1);
    const r = await row();
    expect(r?.calendar_id).toBe('cal1@group.calendar.google.com');
    expect(decryptToken(r!.refresh_token_enc!).plain).toBe('refresh-2');
  });

  it('a stored calendar Jon deleted in Google is replaced once; any other calendars.get failure aborts', async () => {
    await connectFlow();
    google.calendars.clear();
    expect((await connectFlow()).result).toBe('connected');
    expect((await row())?.calendar_id).toBe('cal2@group.calendar.google.com');
    google.state.overrides.push((c) =>
      c.method === 'GET' && c.url.pathname.startsWith('/calendar/') ? { status: 500 } : undefined,
    );
    expect((await connectFlow()).result).toBe('failed');
    expect(calendarInserts()).toBe(2);
  });
});

describe('POST /api/admin/google/disconnect (T3.3.05)', () => {
  const post = () =>
    disconnect(
      new NextRequest(`${SITE}/api/admin/google/disconnect`, { method: 'POST', headers: { origin: SITE } }),
    );

  it('revokes the grant, forgets the token, keeps the calendar; reconnect reuses it', async () => {
    await connectFlow();
    const res = await post();
    expect(res.status).toBe(200);
    expect(revokes()).toEqual(['refresh-1']);
    const r = await row();
    expect(r?.refresh_token_enc).toBeNull();
    expect(r?.calendar_id).toBe('cal1@group.calendar.google.com');
    expect(r?.last_error).toBe('disconnected');
    await expect(googleAccessToken()).rejects.toThrow(/not connected/);

    google.state.refreshToken = 'refresh-3';
    expect((await connectFlow()).result).toBe('connected');
    expect(calendarInserts()).toBe(1);
    expect((await row())?.last_error).toBeNull();
  });

  it('still forgets the token when Google refuses the revoke (Jon already removed access)', async () => {
    await connectFlow();
    google.state.overrides.push((c) =>
      c.url.pathname === '/revoke' ? { status: 400, json: { error: 'invalid_token' } } : undefined,
    );
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: true });
    expect((await row())?.refresh_token_enc).toBeNull();
  });

  it('pr35 F5: a transient revoke failure keeps the grant and answers 503 so Jon retries', async () => {
    await connectFlow();
    const outage = (c: { url: URL }) => (c.url.pathname === '/revoke' ? { status: 503 } : undefined);
    google.state.overrides.push(outage);
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: false, code: 'revoke_unavailable' });
    expect(decryptToken((await row())!.refresh_token_enc!).plain).toBe('refresh-1');
    expect((await row())?.last_error).toBeNull();
    google.state.overrides = [];
    const again = await post();
    expect(await again.json()).toEqual({ ok: true, revoked: true });
    expect((await row())?.refresh_token_enc).toBeNull();
  });

  it('pr35 F5: a token under a lost key is forgotten, and the answer says Google was never told', async () => {
    await q(
      `insert into oauth_connection (provider, account_email, refresh_token_enc, scopes, calendar_id)
       values ('google', 'jon@example.com', $1, $2, 'cal1@group.calendar.google.com')`,
      [encryptWith(Buffer.alloc(32, 1), 'refresh-x'), G3],
    );
    const res = await post();
    expect(await res.json()).toEqual({ ok: true, revoked: false });
    expect(revokes()).toHaveLength(0);
    expect((await row())?.refresh_token_enc).toBeNull();
  });

  it('is a no-op when nothing is connected', async () => {
    expect((await post()).status).toBe(200);
    expect(google.calls).toHaveLength(0);
  });
});

describe('googleAccessToken (T3.3.02 rotation; T3.14 inputs)', () => {
  async function storeRaw(enc: Buffer) {
    await q(
      `insert into oauth_connection (provider, account_email, refresh_token_enc, scopes, calendar_id)
       values ('google', 'jon@example.com', $1, $2, 'cal1@group.calendar.google.com')`,
      [enc, G3],
    );
  }

  it('re-encrypts a token still under the previous key, then serves from cache', async () => {
    await storeRaw(encryptWith(Buffer.from(TEST_ENC_KEY_OLD, 'base64'), 'refresh-old'));
    expect(await googleAccessToken()).toBe('access-for-refresh-old');
    const r = await row();
    expect(decryptToken(r!.refresh_token_enc!)).toEqual({ plain: 'refresh-old', stale: false });
    expect(r?.last_ok_at).not.toBeNull();
    await googleAccessToken();
    expect(google.calls.filter((c) => c.url.pathname === '/token')).toHaveLength(1);
  });

  it('pr35 F5: the access token is cached for at most 5 minutes', async () => {
    await storeRaw(encryptWith(Buffer.from(TEST_ENC_KEY, 'base64'), 'refresh-a'));
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await googleAccessToken();
    clock.mockReturnValue(now + 5 * 60_000 - 1000);
    await googleAccessToken();
    expect(google.calls.filter((c) => c.url.pathname === '/token')).toHaveLength(1);
    clock.mockReturnValue(now + 5 * 60_000 + 1000);
    await googleAccessToken();
    expect(google.calls.filter((c) => c.url.pathname === '/token')).toHaveLength(2);
    clock.mockRestore();
  });

  it('pr35 F2: a refresh that lands after a Disconnect neither resurrects the token nor gets cached', async () => {
    await storeRaw(encryptWith(Buffer.from(TEST_ENC_KEY_OLD, 'base64'), 'refresh-old')); // stale: would re-encrypt
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(input)).pathname === '/token') {
        await q(
          `update oauth_connection set refresh_token_enc = null, last_error = 'disconnected' where provider = 'google'`,
        );
      }
      return google.fetch(input, init);
    });
    await expect(googleAccessToken()).rejects.toThrow(/changed during the refresh/);
    const r = await row();
    expect(r?.refresh_token_enc).toBeNull();
    expect(r?.last_error).toBe('disconnected');
    await expect(googleAccessToken()).rejects.toThrow(/not connected/); // nothing was cached
  });

  it('pr35 F2: a failed refresh after a reconnect does not stamp its error on the new grant', async () => {
    await storeRaw(encryptWith(Buffer.from(TEST_ENC_KEY, 'base64'), 'refresh-dead'));
    google.state.revoked.add('refresh-dead');
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(input)).pathname === '/token') {
        await q(`update oauth_connection set refresh_token_enc = $1 where provider = 'google'`, [
          encryptWith(Buffer.from(TEST_ENC_KEY, 'base64'), 'refresh-new'),
        ]);
      }
      return google.fetch(input, init);
    });
    await expect(googleAccessToken()).rejects.toMatchObject({ reason: 'invalid_grant' });
    expect((await row())?.last_error).toBeNull();
  });

  it('records invalid_grant on the row and rethrows', async () => {
    await storeRaw(encryptWith(Buffer.from(TEST_ENC_KEY, 'base64'), 'refresh-dead'));
    google.state.revoked.add('refresh-dead');
    await expect(googleAccessToken()).rejects.toMatchObject({ reason: 'invalid_grant', status: 400 });
    expect((await row())?.last_error).toBe('invalid_grant');
  });

  it('a token under neither key fails loudly (no garbage token is sent to Google)', async () => {
    await storeRaw(encryptWith(Buffer.alloc(32, 1), 'refresh-x'));
    await expect(googleAccessToken()).rejects.toThrow(/does not open/);
    expect(google.calls).toHaveLength(0);
  });
});
