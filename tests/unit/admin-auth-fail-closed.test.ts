// Security review 2026-09-30 (C1): while the sign-in limiter can't count, the admin sign-in routes refuse with a
// clear 503 (or, for the emailed link, a redirect to the "paused" notice) and never reach Supabase. Before this,
// hit() failed OPEN, so a limiter outage meant unthrottled code guesses.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SITE } from '../fixtures/unit-env';
import { SIGN_IN } from '@/content/ui/admin-requests';

vi.mock('@/lib/db', () => {
  const down = () => {
    throw new Error('cannot execute INSERT in a read-only transaction');
  };
  return { q: vi.fn(down), withTx: vi.fn(down), pool: vi.fn(down) };
});
const completeSignIn = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('@/features/admin/verify', () => ({ completeSignIn }));
const sendAdminSignIn = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/features/admin/signin', () => ({ sendAdminSignIn }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: vi.fn(async () => true) }));
vi.mock('@/app/admin/auth/confirm-token', async (orig) => ({
  ...(await orig<typeof import('@/app/admin/auth/confirm-token')>()),
  verifyConfirm: () => true,
}));
vi.mock('@/lib/report', () => ({ report: vi.fn(), reportMessage: vi.fn(), errorName: () => 'Error' }));

const json = (path: string, body: unknown) =>
  new NextRequest(`${SITE}${path}`, {
    method: 'POST',
    headers: { origin: SITE, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  completeSignIn.mockClear();
  sendAdminSignIn.mockClear();
});

describe('admin sign-in fails closed when the limiter is down', () => {
  it('start: 503 unavailable, no email sent', async () => {
    const { POST } = await import('@/app/api/admin/auth/start/route');
    const res = await POST(json('/api/admin/auth/start', { email: 'jon@example.com', turnstileToken: 't' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, code: 'unavailable', message: SIGN_IN.unavailable });
    expect(sendAdminSignIn).not.toHaveBeenCalled();
  });

  it('verify: 503 unavailable, the code is never checked', async () => {
    const { POST } = await import('@/app/api/admin/auth/verify/route');
    const res = await POST(json('/api/admin/auth/verify', { email: 'jon@example.com', code: '123456' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, code: 'unavailable', message: SIGN_IN.unavailable });
    expect(completeSignIn).not.toHaveBeenCalled();
  });

  it('confirm: redirects to the paused notice, the link token is not spent', async () => {
    const { POST } = await import('@/app/api/admin/auth/confirm/route');
    const form = new FormData();
    form.set('token_hash', 'a'.repeat(56));
    form.set('csrf', 'x');
    const res = await POST(
      new NextRequest(`${SITE}/api/admin/auth/confirm`, {
        method: 'POST',
        headers: { origin: SITE },
        body: form,
      }),
    );
    if (res.status === 400) throw new Error('fixture token_hash does not match TOKEN_HASH; adjust the test');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${SITE}/admin/sign-in?error=unavailable`);
    expect(completeSignIn).not.toHaveBeenCalled();
  });
});
