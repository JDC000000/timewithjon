// T2.1.04: the real @supabase/ssr client writes the admin session cookies SameSite=Lax, Secure and httpOnly.
// Only fetch (the Auth server) and next/headers (the cookie store) are faked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../../tests/fixtures/unit-env';
import { adminAuthClient } from '../supabase';

const jar = vi.hoisted(() => ({
  set: vi.fn(),
  getAll: vi.fn(() => [] as { name: string; value: string }[]),
}));
vi.mock('next/headers', () => ({ cookies: async () => jar }));

afterEach(() => vi.unstubAllGlobals());

describe('admin session cookies', () => {
  it('verifyOtp stores the session in Lax, Secure, httpOnly cookies', async () => {
    const now = Math.floor(Date.now() / 1000);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          access_token: 'header.payload.sig',
          refresh_token: 'refresh',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: now + 3600,
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            email: 'jon@example.com',
            aud: 'authenticated',
          },
        }),
      ),
    );
    const client = await adminAuthClient();
    const { error } = await client.auth.verifyOtp({ token_hash: 'a'.repeat(56), type: 'email' });
    expect(error).toBeNull();
    const writes = jar.set.mock.calls.filter(([, value]) => value !== '');
    expect(writes.length).toBeGreaterThan(0);
    for (const [name, , options] of writes) {
      expect(name).toMatch(/^sb-example-auth-token/);
      expect(options).toMatchObject({ sameSite: 'lax', secure: true, httpOnly: true, path: '/' });
    }
  });
});
