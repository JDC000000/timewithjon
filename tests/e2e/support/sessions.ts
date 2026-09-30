// Who a screen is visited as, on the app target. A guest arrives through their real invite link (the seeded
// personal invite for Dave), resolved ONCE per run in global-setup.ts (the invite lookup is rate-limited), and
// the server-issued twj_invite cookie is reused. The admin is signed in to a stand-in Supabase Auth (the same
// scheme as tests/e2e/admin-season/foc-04.spec.ts, lane U6): the prototype server runs with FEATURE_ADMIN_AUTH=1
// and SUPABASE_URL at the stand-in (tests/e2e/run.sh), which answers GET /auth/v1/user for ADMIN_EMAILS' address.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { BrowserContext } from '@playwright/test';

export type Visitor = 'guest' | 'admin';

/** The seeded personal invite (supabase/seed.sql): its link's ?for= value. */
export const GUEST_INVITE_FOR = 'dave-k7q2m9xp';
export const FAKE_AUTH_PORT = Number(process.env.E2E_FAKE_AUTH_PORT ?? 54999);
export const SESSIONS_FILE = path.join('test-results', 'e2e-sessions.json');

const ADMIN_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  email: 'jon@example.com',
};

/** The stand-in Supabase Auth. Resolves when listening (or when another run's stand-in already holds the port). */
export function startFakeAuth(port = FAKE_AUTH_PORT): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const ok = req.url?.startsWith('/auth/v1/user') && /^Bearer \S+/.test(req.headers.authorization ?? '');
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(ok ? { ...ADMIN_USER, role: 'authenticated', app_metadata: {}, user_metadata: {} } : {}),
    );
  });
  return new Promise((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) =>
      e.code === 'EADDRINUSE' ? resolve(server) : reject(e),
    );
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/** The @supabase/ssr session cookie for the stand-in Auth (sb-<first host label>-auth-token, base64url JSON). */
export function adminSessionCookie(): { name: string; value: string } {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ADMIN_USER.id, email: ADMIN_USER.email, exp })}.x`;
  const session = {
    access_token: jwt,
    refresh_token: 'r',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    user: ADMIN_USER,
  };
  return { name: 'sb-127-auth-token', value: `base64-${b64(session)}` };
}

type Saved = { guest?: { name: string; value: string } };

/** Put the visitor's session in the browser context before the first page load. */
export async function signInAs(context: BrowserContext, who: Visitor, baseURL: string): Promise<void> {
  if (who === 'admin') {
    await context.addCookies([{ ...adminSessionCookie(), url: baseURL }]);
    return;
  }
  const saved = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')) as Saved;
  if (!saved.guest)
    throw new Error(`no guest session in ${SESSIONS_FILE}: did global-setup resolve the invite?`);
  await context.addCookies([{ ...saved.guest, url: baseURL }]);
}
