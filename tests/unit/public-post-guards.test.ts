// T3.8.02/.03 (TSD T3.8 AC3, AD-9): finds every public state-changing route under src/app (any export shape) and proves the
// per-IP limiter runs FIRST (right after the Origin check): with the limiter's counter over the limit, each one
// answers the friendly 429 before touching a cookie, a token, the body or any other query. It grows by itself:
// a new public POST without limitByIp() fails here. Admin routes (T2.1.05 test), cron and jobs (secret) are out;
// Svix-verified webhooks are the only exemption.
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SITE } from '../fixtures/unit-env';
import { ERRORS } from '@/content';

const calls: unknown[][] = [];
vi.mock('@/lib/db', () => ({
  q: vi.fn(async (...args: unknown[]) => {
    calls.push(args);
    return [{ count: 1_000_000 }];
  }),
  withTx: vi.fn(() => {
    throw new Error('no transaction before the limiter');
  }),
  pool: vi.fn(),
}));
// pr38 F10: the photo routes pull in sharp + libheif; their cold import made the 429 test flaky under a full run.
vi.mock('@/features/photos/reencode', () => ({
  toCleanJpeg: vi.fn(),
  isHeif: vi.fn(),
  UnreadableImageError: class UnreadableImageError extends Error {},
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => {
    throw new Error('no cookie read before the limiter');
  }),
  headers: vi.fn(() => {
    throw new Error('no header read before the limiter');
  }),
}));

const ROOT = path.resolve(__dirname, '../..');
const APP = 'src/app';
/** Not public: the admin tree (tests/unit/admin-routes.test.ts), the prototype-only /dev tree, and the
 * cron/jobs endpoints (cron secret, tests/unit/jobs-routes.test.ts). Everything else under src/app is. */
const NOT_PUBLIC = /^(admin|dev|api\/(admin|cron|jobs|dev))(\/|$)/;
/** Signed provider webhooks (L4 #34): exempt from Origin/limiter/honeypot ONLY when the module verifies the
 * Svix signature. Anything else under this prefix is treated as a normal public write and must be guarded. */
const WEBHOOKS = /^api\/webhooks(\/|$)/;
/** Public writes that aren't forms (no human-typed fields), so they carry no honeypot. */
const NOT_FORMS = new Set(['api/photos/sign', 'api/photos/finalise', 'api/manage/cancel', 'api/events']); // cancel: a button, no fields; events: T3.11 beacon
const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Route = { file: string; name: string; src: string; writes: [string, Handler][] };

/** Review F1: every route file in any export shape (`export async function`, `export const`, `export { h as POST }`),
 * found by importing the module and reading its exports, not by matching source text. */
const allRoutes: Route[] = await Promise.all(
  globSync(`${APP}/**/route.{ts,tsx,js}`, { cwd: ROOT }).map(async (file) => {
    const mod = (await import(path.join(ROOT, file))) as Record<string, unknown>;
    return {
      file,
      name: path.dirname(path.relative(APP, file)).split(path.sep).join('/'),
      src: readFileSync(path.join(ROOT, file), 'utf8'),
      writes: WRITES.filter((m) => typeof mod[m] === 'function').map((m) => [m, mod[m] as Handler]),
    };
  }),
);
const isVerifiedWebhook = (r: Pick<Route, 'name' | 'src'>) =>
  WEBHOOKS.test(r.name) && /import[^;]*\bverifySvix\b[^;]*from/.test(r.src) && /\bverifySvix\(/.test(r.src);
const publicWrites = allRoutes.filter((r) => r.writes.length > 0 && !NOT_PUBLIC.test(r.name));
const routes = publicWrites.filter((r) => !isVerifiedWebhook(r));

beforeEach(() => {
  calls.length = 0;
});

describe('every public write route', () => {
  it('the scan finds the known public POSTs', () => {
    const names = routes.map((r) => r.name);
    for (const known of ['api/requests', 'api/stories', 'api/photos/sign']) expect(names).toContain(known);
  });

  it.each(routes)(
    '$name: over the limit → the friendly 429, before anything else',
    async ({ file, writes }) => {
      for (const [method, handler] of writes) {
        calls.length = 0;
        const res = await handler(
          new NextRequest(`${SITE}/api/probe`, {
            method,
            headers: { origin: SITE, 'content-type': 'application/json', cookie: 'twj_req=x; twj_invite=x' },
            body: '{"hp":"x"}',
          }),
          { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000000', token: 'x' }) },
        );
        expect(res.status, `${method} ${file}`).toBe(429);
        expect(await res.json()).toEqual({ ok: false, code: 'rate_limited', message: ERRORS.rateLimited });
        expect(calls).toHaveLength(1);
        expect(String(calls[0]![0])).toMatch(/\brate_limit\b/);
      }
    },
    20_000,
  );

  it.each(routes.filter((r) => !NOT_FORMS.has(r.name)))(
    '$name: a form route carries the shared honeypot',
    ({ src }) => {
      expect(src).toMatch(/from '@\/lib\/honeypot'/);
      expect(src).toMatch(/isHoneypotFilled\(/);
    },
  );

  // An unverified webhook stays in `routes`, so the limiter/honeypot checks above fail for it.
  it.each([
    ['api/webhooks/resend', "import { verifySvix } from '@/lib/svix';\nawait verifySvix(req);", true],
    ['api/webhooks/resend/events', "import { x, verifySvix } from '@/lib/svix';\nverifySvix(req)", true],
    ['api/webhooks/resend', 'export async function POST() {}', false],
    ['api/webhooks/resend', "import { verifySvix } from '@/lib/svix';", false],
    ['api/webhooks/resend', '// verifySvix(req) is on the to-do list', false],
    ['api/webhooksx', "import { verifySvix } from '@/lib/svix';\nverifySvix(req)", false],
    ['api/stories', "import { verifySvix } from '@/lib/svix';\nverifySvix(req)", false],
  ])('%s exempt only with a Svix check: %j → %s', (name, src, exempt) =>
    expect(isVerifiedWebhook({ name, src })).toBe(exempt),
  );

  it('every exempt route is a Svix-verified webhook', () => {
    for (const r of publicWrites.filter((w) => !routes.includes(w)))
      expect(isVerifiedWebhook(r), r.file).toBe(true);
  });
});

describe('server actions (AD-2: every state change is a Route Handler)', () => {
  it("no 'use server' anywhere in src/", () => {
    const withDirective = globSync('src/**/*.{ts,tsx,js}', { cwd: ROOT }).filter((f) =>
      /^\s*['"]use server['"]/m.test(readFileSync(path.join(ROOT, f), 'utf8')),
    );
    expect(withDirective).toEqual([]);
  });
});
