// src/config/csp.ts — T4.1.05: the per-request Content-Security-Policy. src/proxy.ts calls it with a fresh nonce.
// Pure (the dev flag and the Supabase origin are passed in), so the unit tests pin the exact directives.

/**
 * script-src: only scripts carrying this request's nonce run; 'strict-dynamic' lets them load more (Turnstile's
 * api.js injected by useTurnstile). challenges.cloudflare.com stays for browsers without 'strict-dynamic'.
 * Dev only: React's dev build needs 'unsafe-eval' (error-stack reconstruction); production never gets it.
 * `supabase`: the configured project's origin (SUPABASE_URL), the only one images and uploads may reach; none
 * given = no Supabase origin at all.
 */
export function buildCsp(nonce: string, isDev = false, supabase?: string): string {
  const project = supabase ? ` ${supabase}` : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ''}`,
    // 'unsafe-inline' stays for styles: next/font and React inline style attributes carry no nonce.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data:${project}`,
    "font-src 'self'",
    `connect-src 'self'${project} https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://challenges.cloudflare.com`,
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
