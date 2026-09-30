// T2.1.05 (TSD T2.1 AC2): finds every /api/admin/** route and proves it refuses a caller with no session (401)
// and any write from a foreign Origin (403). It grows by itself as M2 adds routes; a route without
// requireAdmin() fails here. Only the pre-sign-in routes in PUBLIC skip the 401 check (they keep the 403).
import { globSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SITE } from '../fixtures/unit-env';

vi.mock('@/features/admin/supabase', () => ({
  currentAuthEmail: vi.fn(async () => null),
  adminAuthClient: vi.fn(() => {
    throw new Error('no Auth client in this test');
  }),
  sendOtpEmail: vi.fn(() => {
    throw new Error('no email in this test');
  }),
}));
vi.mock('@/lib/db', () => {
  const noDb = () => {
    throw new Error('no database in this test');
  };
  return { q: vi.fn(noDb), withTx: vi.fn(noDb), pool: vi.fn(noDb) };
});

const ROOT = path.resolve(__dirname, '../..');
const API_ADMIN = 'src/app/api/admin';
/** Routes that run before there is a session. Each must still refuse a foreign Origin. */
const PUBLIC = new Set(['auth/start', 'auth/verify', 'auth/confirm']);
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const routes = globSync(`${API_ADMIN}/**/route.ts`, { cwd: ROOT }).map((file) => ({
  file,
  name: path.dirname(path.relative(API_ADMIN, file)).split(path.sep).join('/'),
}));
/** Route handlers under the /admin pages tree (the emailed link's callback, T2.1.04). */
const PAGE_ADMIN = 'src/app/admin';
const pageRoutes = globSync(`${PAGE_ADMIN}/**/route.ts`, { cwd: ROOT }).map((file) => ({
  file,
  name: `/admin/${path.dirname(path.relative(PAGE_ADMIN, file)).split(path.sep).join('/')}`,
}));

async function handlersOf(file: string): Promise<[string, Handler][]> {
  const mod = (await import(path.join(ROOT, file))) as Record<string, unknown>;
  return METHODS.filter((m) => typeof mod[m] === 'function').map((m) => [m, mod[m] as Handler]);
}

const call = (handler: Handler, method: string, origin: string) =>
  handler(
    new NextRequest(`${SITE}/api/admin/probe`, {
      method,
      headers: { origin, 'content-type': 'application/json' },
      body: method === 'GET' || method === 'HEAD' ? undefined : '{}',
    }),
    { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000000' }) },
  );

// pr39 F7 + pr48 F1: every case here cold-imports route modules (the first one pulls the whole route graph, and the
// 404 sweep re-imports all of them after vi.resetModules), 3 s+ on a busy 4-core box: one budget for the whole block.
describe('every /api/admin/** route', { timeout: 30_000 }, () => {
  it('is found, and every PUBLIC entry still exists', () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const name of PUBLIC) expect(routes.map((r) => r.name)).toContain(name);
  });

  it.each(routes)('$name: 401 with no session (unless PUBLIC)', async ({ file, name }) => {
    if (PUBLIC.has(name)) return;
    const handlers = await handlersOf(file);
    expect(handlers.length).toBeGreaterThan(0);
    for (const [method, handler] of handlers) {
      expect((await call(handler, method, SITE)).status, `${method} ${name}`).toBe(401);
    }
  });

  it('every route answers 404 to every method while FEATURE_ADMIN_AUTH is off (TSD waiver)', async () => {
    vi.resetModules(); // a fresh getEnv() cache that sees the flag unset
    delete process.env.FEATURE_ADMIN_AUTH;
    try {
      for (const { file, name } of [...routes, ...pageRoutes]) {
        for (const [method, handler] of await handlersOf(file)) {
          expect((await call(handler, method, SITE)).status, `${method} ${name}`).toBe(404);
        }
      }
    } finally {
      process.env.FEATURE_ADMIN_AUTH = '1';
      vi.resetModules();
    }
  });

  it.each(routes)('$name: 403 for a write from a foreign Origin', async ({ file, name }) => {
    for (const [method, handler] of await handlersOf(file)) {
      if (method === 'GET' || method === 'HEAD') continue;
      expect((await call(handler, method, 'https://evil.example')).status, `${method} ${name}`).toBe(403);
    }
  });
});

describe('the emailed link (T2.1.U1: the A1c page + POST /api/admin/auth/confirm)', () => {
  it('no route handler spends a token under /admin: the link opens a page with no side effects', () => {
    expect(pageRoutes.map((r) => r.name)).toEqual([]);
  });

  it('confirm refuses a form with no, a repeated or a malformed token_hash with a 400, before any Auth call', async () => {
    const { POST } = (await import('@/app/api/admin/auth/confirm/route')) as {
      POST: (r: NextRequest) => Promise<Response>;
    };
    const post = (body: string) =>
      POST(
        new NextRequest(`${SITE}/api/admin/auth/confirm`, {
          method: 'POST',
          headers: { origin: SITE, 'content-type': 'application/x-www-form-urlencoded' },
          body,
        }),
      );
    const h = 'a'.repeat(56);
    for (const body of [
      '',
      `csrf=x`,
      `token_hash=${h}`,
      `token_hash=${h}&token_hash=${h}&csrf=x`,
      `token_hash=zz&csrf=x`,
    ]) {
      expect((await post(body)).status, body).toBe(400);
    }
    // A well-formed link without this page's CSRF token (e.g. a cross-site form, a scanner) is a 403.
    expect((await post(`token_hash=${h}&csrf=1.${'A'.repeat(43)}`)).status).toBe(403);
  });
});
