// src/proxy.ts — Next 16 proxy (formerly middleware). Two jobs: a per-request CSP nonce (T4.1.05) on every
// matched path, and routing ?for= to the resolver.
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, newNonce } from '@/config/csp';
import { isDevServer } from '@/config/env';

export function proxy(req: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp(nonce, isDevServer());
  // Next reads the nonce from the request's CSP header while rendering and stamps it on its own <script> tags.
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);

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
