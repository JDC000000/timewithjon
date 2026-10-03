// T0.1 AC2 (T0.1.12): every path gets noindex + same-origin referrers; Sentry wiring has no Replay.
// The CSP moved to src/proxy.ts (T4.1.05, per-request nonce): tests/unit/csp.test.ts.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { baseConfig, IMAGE_FILES, IMAGE_HEADERS, SECURITY_HEADERS } from '../../next.config';

it('every path gets noindex and same-origin referrers, and no static CSP (the proxy sets it per request)', async () => {
  const h = await baseConfig.headers!();
  expect(h[0]!.source).toBe('/:path*');
  expect(h[0]!.headers).toEqual(SECURITY_HEADERS);
  const m = Object.fromEntries(SECURITY_HEADERS.map((x) => [x.key, x.value]));
  expect(m['X-Robots-Tag']).toBe('noindex, nofollow');
  expect(m['Referrer-Policy']).toBe('same-origin');
  expect(m['Content-Security-Policy']).toBeUndefined();
});

it('the photos in /img cache for a day (stale for a week), never immutable, and keep the security headers', async () => {
  const h = await baseConfig.headers!();
  const img = h.find((r) => r.source === IMAGE_FILES)!;
  expect(IMAGE_FILES).toBe('/img/:path*');
  expect(img.headers).toEqual(IMAGE_HEADERS);
  expect(IMAGE_HEADERS).toEqual([
    { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
  ]);
  // the file names carry no content hash and a private build swaps them in place
  expect(IMAGE_HEADERS[0]!.value).not.toMatch(/immutable/);
  // it only adds Cache-Control: the site-wide security headers still match /img (the first rule, '/:path*')
  expect(img.headers.map((x) => x.key)).toEqual(['Cache-Control']);
  expect(SECURITY_HEADERS.some((x) => x.key === 'Cache-Control')).toBe(false);
  expect(h.indexOf(img)).toBeGreaterThan(0);
});

it('AD-11: no Sentry Replay anywhere', () => {
  for (const f of ['sentry.server.config.ts', 'src/instrumentation-client.ts', 'src/instrumentation.ts']) {
    expect(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')).not.toMatch(/replay/i);
  }
});

// The data-collection shape test was replaced by tests/unit/sentry-envelope.test.ts (T4.2.01a M1).
