// T4.1.05: script-src is nonce-based (no 'unsafe-inline'); src/proxy.ts sets a fresh nonce on every request.
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { buildCsp } from '@/config/csp';
import { proxy } from '@/proxy';

const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `));

describe('buildCsp', () => {
  it('script-src allows only this nonce, strict-dynamic and Turnstile; never unsafe-inline or unsafe-eval', () => {
    const csp = buildCsp('abc123');
    expect(directive(csp, 'script-src')).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic' https://challenges.cloudflare.com",
    );
    expect(csp).not.toContain('unsafe-eval');
  });

  it('adds unsafe-eval only in dev (React dev build)', () => {
    expect(directive(buildCsp('n', true), 'script-src')).toContain("'unsafe-eval'");
  });

  it('keeps the other directives', () => {
    const csp = buildCsp('n');
    expect(directive(csp, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('frame-src https://challenges.cloudflare.com');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('images and uploads may reach the configured Supabase project only, never any *.supabase.co', () => {
    const csp = buildCsp('n', false, 'https://abcd1234.supabase.co');
    expect(directive(csp, 'img-src')).toBe("img-src 'self' blob: data: https://abcd1234.supabase.co");
    expect(directive(csp, 'connect-src')).toBe(
      "connect-src 'self' https://abcd1234.supabase.co https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://challenges.cloudflare.com",
    );
    expect(csp).not.toContain('*.supabase.co');
    // No project configured: no Supabase origin at all (never a wildcard).
    expect(directive(buildCsp('n'), 'img-src')).toBe("img-src 'self' blob: data:");
  });
});

describe('proxy CSP nonce', () => {
  const run = (path: string) => {
    const res = proxy(new NextRequest(new URL(path, 'https://twj.test')));
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    // NextResponse.next/rewrite({ request: { headers } }) forwards request headers as x-middleware-request-*.
    const reqNonce = res.headers.get('x-middleware-request-x-nonce');
    const reqCsp = res.headers.get('x-middleware-request-content-security-policy');
    return { res, csp, reqNonce, reqCsp };
  };

  it.each([
    ['plain page', '/'],
    ['?for= rewrite', '/?for=abc'],
  ])("%s: the response and the forwarded request carry the same nonce'd CSP", (_label, path) => {
    const { csp, reqNonce, reqCsp } = run(path);
    expect(reqNonce).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
    expect(csp).toContain(`'nonce-${reqNonce}'`);
    expect(reqCsp).toBe(csp);
    expect(directive(csp, 'script-src')).not.toContain('unsafe-inline');
    // The proxy pins the project from SUPABASE_URL (tests/fixtures env: whatever it is, never the wildcard).
    expect(csp).not.toContain('*.supabase.co');
  });

  it('the ?for= branch still rewrites to the resolver', () => {
    const { res } = run('/manage?for=abc');
    const target = new URL(res.headers.get('x-middleware-rewrite') ?? '');
    expect(target.pathname).toBe('/api/invite/resolve');
    expect(target.searchParams.get('for')).toBe('abc');
    expect(target.searchParams.get('next')).toBe('/manage');
  });

  it('a new nonce on every request', () => {
    const a = run('/').reqNonce;
    const b = run('/').reqNonce;
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
