// next.config.ts — AD-12 headers, AD-13 compile-time /dev exclusion (verified on Next 16.3).
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { APP_MODES, type AppMode } from './src/config/env';

const isProto = process.env.APP_MODE === 'prototype';

// The CSP is NOT here: src/proxy.ts sets it per request with a nonce (T4.1.05). A second, static CSP would
// intersect with it and block the nonce'd scripts.
export const SECURITY_HEADERS = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/**
 * pr32-review L3: the token pages carry the raw action token in their URL (?t=). No-referrer, so no same-origin
 * sub-request (API fetch, asset) repeats it in a Referer header; private, no-store, so nothing caches the page.
 * The manage APIs answer with the same policy (src/lib/http.ts tokenNoStore). Listed AFTER the site-wide entry,
 * so these values win for these paths.
 */
export const TOKEN_PAGES = '/(manage|offer|new-date)';
export const TOKEN_PAGE_HEADERS = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cache-Control', value: 'private, no-store' },
];

/**
 * pr73-review F2: the signed-in admin pages are never cached, pinned here rather than left to force-dynamic.
 * Listed after the site-wide entry, so this Cache-Control wins for these paths.
 */
export const ADMIN_PAGES = '/admin/:path*';
export const ADMIN_PAGE_HEADERS = [{ key: 'Cache-Control', value: 'private, no-store' }];

/**
 * pr75-review F1: the A1c sign-in page carries the emailed one-time token_hash in its URL. strict-origin, so every
 * sub-request's Referer is cut to the bare origin and the hash never travels in a Referer. NOT no-referrer (the
 * token pages' value): under no-referrer browsers send `Origin: null` on the page's "Sign me in" form POST, which
 * the confirm route's same-origin check refuses (checked in Chromium and WebKit). Listed after ADMIN_PAGES, which
 * gives this page private, no-store.
 */
export const SIGN_IN_LINK_PAGE = '/admin/auth/callback';
export const SIGN_IN_LINK_PAGE_HEADERS = [{ key: 'Referrer-Policy', value: 'strict-origin' }];

/**
 * The photos in public/img (docs/PHOTOS.md). Next serves public files with max-age=0, must-revalidate, so every
 * page view re-asked for every photo. A day fresh, then a week served stale while it refreshes. NOT immutable: the
 * file names carry no content hash, and a private build swaps the files in under the same names.
 */
export const IMAGE_FILES = '/img/:path*';
export const IMAGE_HEADERS = [
  { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
];

export const baseConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next 16 writes an agent-rules block into AGENTS.md on `next dev`; the repo's AGENTS.md is hand-kept (U1).
  agentRules: false,
  // T3.6: heic-decode's decoder (libheif-js) runs from node_modules exactly as the tests run it, not re-bundled.
  // sharp is on Next's built-in external list already.
  serverExternalPackages: ['heic-decode'],
  // The browser Sentry init tags events with the mode (T0.1.16). APP_MODE is public (it names the environment).
  env: { NEXT_PUBLIC_APP_MODE: process.env.APP_MODE ?? '' },
  // Files named page.dev.tsx / route.dev.ts only exist in APP_MODE=prototype builds.
  pageExtensions: isProto ? ['dev.tsx', 'dev.ts', 'tsx', 'ts'] : ['tsx', 'ts'],
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      { source: TOKEN_PAGES, headers: TOKEN_PAGE_HEADERS },
      { source: ADMIN_PAGES, headers: ADMIN_PAGE_HEADERS },
      { source: SIGN_IN_LINK_PAGE, headers: SIGN_IN_LINK_PAGE_HEADERS },
      { source: IMAGE_FILES, headers: IMAGE_HEADERS },
    ];
  },
};
/**
 * Review L3: the browser bundle's Sentry environment is APP_MODE copied in at build time. A missing or misspelt
 * value would leave it empty, and the SDK would then report "production" (the T0.1.16 symptom). Fail the build.
 */
export function buildAppMode(value: string | undefined): AppMode {
  if (!APP_MODES.includes(value as AppMode)) {
    throw new Error(`APP_MODE must be one of ${APP_MODES.join(', ')} at build time (got "${value ?? ''}")`);
  }
  return value as AppMode;
}

// T0.1.11: Sentry wraps the config. Source maps upload only when SENTRY_AUTH_TOKEN is set (T0.1.10).
export default function nextConfig(phase: string) {
  if (phase === PHASE_PRODUCTION_BUILD) buildAppMode(process.env.APP_MODE);
  return withSentryConfig(baseConfig, { silent: true, telemetry: false, widenClientFileUpload: false });
}
