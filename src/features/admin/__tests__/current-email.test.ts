// Review L13: a forged or expired admin cookie is answered with "not signed in" and is NOT reported to Sentry
// (anyone could send one on every request and drain the quota). Only Auth outages (network, 5xx) are reported.
// The real @supabase/ssr client runs; only fetch (the Auth server), the cookie store and report() are faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../../tests/fixtures/unit-env';
import { report } from '@/lib/report';
import { currentAuthEmail } from '../supabase';

const jar = vi.hoisted(() => ({ set: vi.fn(), getAll: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => jar }));
vi.mock('@/lib/report', () => ({ report: vi.fn() }));

/** A session cookie as @supabase/ssr stores it; `expiresIn` < 0 makes it an expired one. */
function sessionCookie(expiresIn: number) {
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: 'forged.header.sig',
    refresh_token: 'forged-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + expiresIn,
    user: { id: '00000000-0000-4000-8000-000000000001', email: 'jon@example.com', aud: 'authenticated' },
  };
  return [{ name: 'sb-example-auth-token', value: JSON.stringify(session) }];
}
const authAnswers = (status: number, body: object) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(body, { status })),
  );

beforeEach(() => {
  vi.mocked(report).mockReset();
  jar.set.mockReset();
  jar.getAll.mockReset().mockReturnValue(sessionCookie(3600));
});
afterEach(() => vi.unstubAllGlobals());

describe('currentAuthEmail and Sentry (review L13)', () => {
  it('no cookie: null, no report', async () => {
    jar.getAll.mockReturnValue([]);
    authAnswers(500, {});
    expect(await currentAuthEmail()).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it('a forged cookie (403 bad_jwt): null, no report', async () => {
    authAnswers(403, { code: 403, error_code: 'bad_jwt', msg: 'invalid JWT' });
    expect(await currentAuthEmail()).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it('an expired cookie whose refresh is refused (400): null, no report', async () => {
    jar.getAll.mockReturnValue(sessionCookie(-60));
    authAnswers(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
    expect(await currentAuthEmail()).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it('Auth failing (5xx) or unreachable: null, and reported', async () => {
    authAnswers(500, { code: 500, msg: 'boom' });
    expect(await currentAuthEmail()).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);

    vi.mocked(report).mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(await currentAuthEmail()).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
  });
});
