// src/proxy.ts — Next 16 proxy (formerly middleware). Three jobs: a per-request CSP nonce (T4.1.05) on every
// matched path, routing ?for= to the resolver, and an admin page's own path for its sign-in ?next= (EML-11).
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, newNonce } from '@/config/csp';
import { isDevServer } from '@/config/env';
import { ADMIN_PATH_HEADER } from '@/features/admin/next-path';

export function proxy(req: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp(nonce, isDevServer());
  // Next reads the nonce from the request's CSP header while rendering and stamps it on its own <script> tags.
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  // EML-11: an admin page knows its own path for the sign-in redirect's ?next= (never trusted from the client).
  headers.delete(ADMIN_PATH_HEADER);
  const path = req.nextUrl.pathname;
  if (path === '/admin' || path.startsWith('/admin/'))
    headers.set(ADMIN_PATH_HEADER, `${path}${req.nextUrl.search}`);

  const forParam = req.nextUrl.searchParams.get('for');
  let res: NextResponse;
  if (!forParam) {
    res = NextResponse.next({ request: { headers } });
  } else {
    const url = req.nextUrl.clone();
    const next = new URL(req.nextUrl.toString());
    next.searchParams.delete('for');
    url.pathname = '/api/invite/resolve';
    url.search = '';
    url.searchParams.set('for', forParam);
    url.searchParams.set('next', `${next.pathname}${next.search}`);
    res = NextResponse.rewrite(url, { request: { headers } });
  }
  res.headers.set('Content-Security-Policy', csp);
  return res;
}
// Skips whole path segments only (api, _next, dev) and the two root files, so a page such as /devices or /apix
// still gets the nonce CSP. tests/unit/proxy-matcher.test.ts compiles it the way Next does.
export const config = {
  matcher: ['/((?!(?:api|_next|dev)(?:/|$)|favicon\\.ico$|robots\\.txt$).*)'],
};
