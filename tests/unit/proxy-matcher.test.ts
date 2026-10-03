// src/proxy.ts runs (and sets the nonce CSP) on every page; it skips only the api, _next and dev segments and the
// two root files. The matcher is compiled here the way Next compiles it, so a prefix such as /devices can't slip out.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { config } from '@/proxy';

// Next's own matcher compiler (the one the build uses); it ships untyped.
const { getMiddlewareMatchers } = createRequire(import.meta.url)(
  'next/dist/build/analysis/get-page-static-info.js',
) as { getMiddlewareMatchers: (matcher: unknown, nextConfig: object) => { regexp: string }[] };
const [compiled] = getMiddlewareMatchers(config.matcher, {});
const runsOn = (path: string) => new RegExp(compiled!.regexp).test(path);

describe('proxy matcher', () => {
  it.each([
    '/',
    '/menu',
    '/story',
    '/admin/inbox',
    '/devices',
    '/development/x',
    '/apix',
    '/api-notes',
    '/img/a.jpg',
  ])('runs on %s', (path) => expect(runsOn(path)).toBe(true));
  it.each([
    '/api',
    '/api/requests',
    '/_next',
    '/_next/static/chunks/a.js',
    '/dev',
    '/dev/outbox',
    '/favicon.ico',
    '/robots.txt',
  ])('skips %s', (path) => expect(runsOn(path)).toBe(false));
});
