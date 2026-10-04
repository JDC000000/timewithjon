// AD-8: every /api/jobs/** and /api/cron/** route refuses a caller without the cron secret, before any work.
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SITE } from '../fixtures/unit-env';

vi.mock('@/lib/db', () => {
  const noDb = () => {
    throw new Error('no database before the secret check');
  };
  return { q: vi.fn(noDb), withTx: vi.fn(noDb), pool: vi.fn(noDb) };
});

const ROOT = path.resolve(__dirname, '../..');
const routes = globSync('src/app/api/{jobs,cron}/**/route.ts', { cwd: ROOT });

describe('job endpoints', () => {
  it('the scan finds /api/jobs/media', () => expect(routes).toContain('src/app/api/jobs/media/route.ts'));
  it.each(routes)(
    '%s: no or wrong secret → 401',
    async (file) => {
      const mod = (await import(path.join(ROOT, file))) as Record<
        string,
        (r: NextRequest) => Promise<Response>
      >;
      const good = 'c'.repeat(32); // tests/fixtures/unit-env.ts
      const shapes: Record<string, string>[] = [
        {},
        { 'x-cron-secret': 'wrong' },
        { 'x-cron-secret': 'c'.repeat(31) },
        { authorization: `Bearer ${good}` }, // the right secret in the wrong header
      ];
      for (const headers of shapes) {
        const res = await mod.POST!(new NextRequest(`${SITE}/api/jobs/probe`, { method: 'POST', headers }));
        expect(res.status).toBe(401);
        expect(res.headers.get('cache-control')).toContain('no-store');
      }
    },
    30_000,
  ); // a cold import of the tick route (every job module) can pass 5 s on a loaded host
  it.each(routes)('%s checks the secret with the one shared helper (lib/cron-auth.ts)', (file) => {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    expect(src).toMatch(/hasCronSecret\(req\)/);
    expect(src).not.toMatch(/safeEqual|CRON_SECRET/);
  });
});
