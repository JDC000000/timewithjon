// src/features/admin/next-path.ts — EML-11: a signed-out tap on "Open the request" (E2, E3, E12, E13, E14, E16) comes
// back to that page after sign-in. The page Jon asked for rides to the sign-in page as ?next=; only a same-origin
// admin page is ever followed (never an outside site, a protocol-relative "//host", a backslash trick or the sign-in
// and auth pages themselves). Client-safe: the sign-in flow reads it too.

const SIGN_IN = '/admin/sign-in';
/** The request header src/proxy.ts sets on every /admin page request (always overwritten: a client can't plant it). */
export const ADMIN_PATH_HEADER = 'x-twj-admin-path';
const ORIGIN = 'https://admin.invalid';

/** `raw` as a safe same-origin admin path ("/admin/requests/<id>?x=1"), or null. */
export function safeAdminNext(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return null;
  // One leading slash, then no slash or backslash: "//evil", "/\evil" and "\\evil" are other hosts to a browser.
  if (!/^\/(?![/\\])/.test(raw) || /[\\\u0000-\u001F\u007F]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== ORIGIN) return null;
  const path = url.pathname;
  if (path !== '/admin' && !path.startsWith('/admin/')) return null;
  if (path === SIGN_IN || path.startsWith(`${SIGN_IN}/`) || path.startsWith('/admin/auth')) return null;
  return `${path}${url.search}`;
}

/** The sign-in page, carrying `next` when it is a safe admin page other than the inbox (the default after sign-in). */
export function signInHref(next: unknown, extra: Record<string, string> = {}): string {
  const safe = safeAdminNext(next);
  const params = new URLSearchParams(extra);
  if (safe && safe !== '/admin') params.set('next', safe);
  const qs = params.toString();
  return qs ? `${SIGN_IN}?${qs}` : SIGN_IN;
}
