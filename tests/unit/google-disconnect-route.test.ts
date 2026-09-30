// dec 55a: POST /api/admin/google/disconnect (T3.3.05), the route behind A7 "Disconnect Google". The real
// requireAdmin's 401 / 403 / 404-while-FEATURE_ADMIN_AUTH-off are proven for every admin route in
// admin-routes.test.ts; the token row going away is proven against the DB in tests/int/google-connect.int.test.ts.
// Here: a refused caller never reaches disconnectGoogle(), and each outcome maps to the answer A7 reads.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { SITE } from '../fixtures/unit-env';

const gate = vi.hoisted(() => ({ answer: null as Response | null }));
vi.mock('@/features/admin/auth', () => ({
  requireAdmin: vi.fn(async () => gate.answer ?? { email: 'jon@example.com' }),
}));
vi.mock('@/lib/report', () => ({ report: vi.fn() }));
vi.mock('@/features/calendar/connection', () => {
  class GoogleRevokeUnavailableError extends Error {}
  return { GoogleRevokeUnavailableError, disconnectGoogle: vi.fn() };
});

import { POST } from '@/app/api/admin/google/disconnect/route';
import { disconnectGoogle, GoogleRevokeUnavailableError } from '@/features/calendar/connection';

const post = () =>
  POST(new NextRequest(`${SITE}/api/admin/google/disconnect`, { method: 'POST', headers: { origin: SITE } }));
const drop = vi.mocked(disconnectGoogle);

beforeEach(() => {
  gate.answer = null;
  drop.mockReset();
});

describe('POST /api/admin/google/disconnect', () => {
  it.each([401, 403, 404])('%i from requireAdmin: passed through, nothing disconnected', async (status) => {
    gate.answer = NextResponse.json({ ok: false }, { status });
    expect((await post()).status).toBe(status);
    expect(drop).not.toHaveBeenCalled();
  });

  it('admin: disconnects once and answers { ok, revoked }, no-store', async () => {
    drop.mockResolvedValueOnce({ revoked: false } as Awaited<ReturnType<typeof disconnectGoogle>>);
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true, revoked: false });
    expect(drop).toHaveBeenCalledTimes(1);
  });

  it('Google not told: 503 revoke_unavailable; anything else: 500', async () => {
    drop.mockRejectedValueOnce(new GoogleRevokeUnavailableError('503'));
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'revoke_unavailable' });
    drop.mockRejectedValueOnce(new Error('db down'));
    expect((await post()).status).toBe(500);
  });
});
