// GET /api/admin/photos (signed photo URLs): every answer is uncached, the refusals as well as the list.
import '../fixtures/unit-env';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE } from '../fixtures/unit-env';

const m = vi.hoisted(() => ({ admin: { email: 'jon@example.com' } as { email: string } | Response }));
vi.mock('@/features/admin/auth', () => ({ requireAdmin: vi.fn(async () => m.admin) }));
vi.mock('@/features/photos/thumbnails', () => ({ storyPhotosForAdmin: vi.fn(async () => []) }));
vi.mock('@/lib/adapters/photos', () => ({ photoStore: vi.fn(() => ({})) }));
const { GET } = await import('@/app/api/admin/photos/route');

const get = (query: string) => GET(new NextRequest(`${SITE}/api/admin/photos${query}`));

describe('GET /api/admin/photos', () => {
  beforeEach(() => {
    m.admin = { email: 'jon@example.com' };
  });
  it('the admin gets the list, uncached', async () => {
    const res = await get('?storyId=11111111-1111-4111-8111-111111111111');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('a refusal (signed out) and a bad id are uncached too', async () => {
    m.admin = new Response(null, { status: 401 });
    const refused = await get('?storyId=11111111-1111-4111-8111-111111111111');
    expect(refused.status).toBe(401);
    expect(refused.headers.get('cache-control')).toBe('no-store');
    m.admin = { email: 'jon@example.com' };
    const bad = await get('?storyId=nope');
    expect(bad.status).toBe(400);
    expect(bad.headers.get('cache-control')).toBe('no-store');
  });
});
