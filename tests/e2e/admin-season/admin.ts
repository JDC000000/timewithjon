// tests/e2e/admin-season/admin.ts (lane U6): the signed-in admin for the lane's FOC-04 specs (A4, A6, A7) and their
// real-input helpers. A stand-in Supabase Auth on E2E_FAKE_AUTH_PORT (default 54999) answers GET /auth/v1/user for
// ADMIN_EMAILS' jon@example.com only; the server under test runs with SUPABASE_URL pointing at it, against a loopback
// test DB. Specs call fakeAdmin() at the top level; they skip unless E2E_ADMIN=fake-auth.
import http from 'node:http';
import { expect, test, type Locator, type Page } from '@playwright/test';

const ADMIN = process.env.E2E_ADMIN === 'fake-auth';
const AUTH_PORT = Number(process.env.E2E_FAKE_AUTH_PORT ?? 54999);
export const TEXT = [1, 2] as const; // 100 % and 200 % text
export const WIDTHS = [375, 1440] as const;

const USER = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', email: 'jon@example.com' };
let auth: http.Server | null = null;

test.beforeAll(async () => {
  auth = http.createServer((req, res) => {
    const ok = req.url?.startsWith('/auth/v1/user') && /^Bearer \S+/.test(req.headers.authorization ?? '');
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(ok ? { ...USER, role: 'authenticated', app_metadata: {}, user_metadata: {} } : {}),
    );
  });
  await new Promise<void>((resolve, reject) => {
    auth!.once('error', (e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' ? resolve() : reject(e)));
    auth!.listen(AUTH_PORT, '127.0.0.1', () => resolve());
  });
});
test.afterAll(async () => {
  await new Promise((r) => auth?.close(r));
});

/** The @supabase/ssr session cookie for the stand-in Auth (sb-<first host label>-auth-token, base64url JSON). */
export function sessionCookie(): { name: string; value: string } {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, exp })}.x`;
  const session = {
    access_token: jwt,
    refresh_token: 'r',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    user: USER,
  };
  return { name: 'sb-127-auth-token', value: `base64-${b64(session)}` };
}

/** Registers the skip, the stand-in Auth for the file's run, and the admin session cookie on every page. */
export function fakeAdmin(): void {
  test.skip(
    !ADMIN,
    'needs E2E_ADMIN=fake-auth and a server with SUPABASE_URL=http://127.0.0.1:<E2E_FAKE_AUTH_PORT>',
  );

  let auth: http.Server | null = null;
  test.beforeAll(async () => {
    auth = http.createServer((req, res) => {
      const ok = req.url?.startsWith('/auth/v1/user') && /^Bearer \S+/.test(req.headers.authorization ?? '');
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify(ok ? { ...USER, role: 'authenticated', app_metadata: {}, user_metadata: {} } : {}),
      );
    });
    await new Promise<void>((resolve, reject) => {
      auth!.once('error', (e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' ? resolve() : reject(e)));
      auth!.listen(AUTH_PORT, '127.0.0.1', () => resolve());
    });
  });
  test.afterAll(async () => {
    await new Promise((r) => auth?.close(r));
  });
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ ...sessionCookie(), url: baseURL! }]);
  });
}

export async function open(page: Page, path: string, scale: number) {
  if (scale !== 1) {
    await page.addInitScript((pct) => {
      // the user's text size, in place before the first layout and before any page script runs
      const apply = () => document.documentElement?.style.setProperty('font-size', `${pct}%`, 'important');
      apply();
      document.addEventListener('DOMContentLoaded', apply);
    }, scale * 100);
  }
  await page.goto(path);
}

/** Focus is on `el` and the whole of it is inside the viewport. */
export async function landedOn(page: Page, el: Locator) {
  await expect(el).toBeFocused();
  const box = await el.boundingBox();
  const vp = page.viewportSize()!;
  expect(box, 'the focused element has a box').not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
}

/** Tab (real key presses) until `el` has focus. */
export async function tabTo(page: Page, el: Locator, max = 60) {
  for (let i = 0; i < max; i++) {
    if (await el.evaluate((n) => n === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('never reached by Tab');
}
