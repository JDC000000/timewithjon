// src/config/csp.ts — T4.1.05: the per-request Content-Security-Policy. src/proxy.ts calls it with a fresh nonce.
// Pure (no env reads beyond the dev flag passed in), so the unit tests pin the exact directives.

/**
 * script-src: only scripts carrying this request's nonce run; 'strict-dynamic' lets them load more (Turnstile's
 * api.js injected by useTurnstile). challenges.cloudflare.com stays for browsers without 'strict-dynamic'.
 * Dev only: React's dev build needs 'unsafe-eval' (error-stack reconstruction); production never gets it.
 */
export function buildCsp(nonce: string, isDev = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ''}`,
    // 'unsafe-inline' stays for styles: next/font and React inline style attributes carry no nonce.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://*.supabase.co",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://challenges.cloudflare.com",
    'frame-src https://challenges.cloudflare.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** A fresh, unguessable nonce per request (the Next.js CSP guide's recipe). */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}
