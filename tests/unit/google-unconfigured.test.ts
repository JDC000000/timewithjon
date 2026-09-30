// T3.3.03/.04 (AD-6): proto and previews have no Google client, so Connect and the callback don't exist there.
import '../fixtures/unit-env';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SITE } from '../fixtures/unit-env';
import { googleConfigured } from '@/lib/adapters/google/oauth';
import { GET as connect } from '@/app/api/admin/google/connect/route';
import { GET as callback } from '@/app/api/admin/google/callback/route';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));
const fetchSpy = vi.fn();
vi.stubGlobal('fetch', fetchSpy);

describe('Google not configured (prototype)', () => {
  it('connect and callback answer 404 and never call Google', async () => {
    expect(googleConfigured()).toBe(false);
    expect((await connect(new NextRequest(`${SITE}/api/admin/google/connect`))).status).toBe(404);
    const res = await callback(new NextRequest(`${SITE}/api/admin/google/callback?state=a&code=b`));
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
