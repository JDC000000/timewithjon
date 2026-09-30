// T0.1 AC2 (T0.1.12): every path gets noindex + same-origin referrers; Sentry wiring has no Replay.
// The CSP moved to src/proxy.ts (T4.1.05, per-request nonce): tests/unit/csp.test.ts.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { baseConfig, SECURITY_HEADERS } from '../../next.config';

it('every path gets noindex and same-origin referrers, and no static CSP (the proxy sets it per request)', async () => {
  const h = await baseConfig.headers!();
  expect(h[0]!.source).toBe('/:path*');
  expect(h[0]!.headers).toEqual(SECURITY_HEADERS);
  const m = Object.fromEntries(SECURITY_HEADERS.map((x) => [x.key, x.value]));
  expect(m['X-Robots-Tag']).toBe('noindex, nofollow');
  expect(m['Referrer-Policy']).toBe('same-origin');
  expect(m['Content-Security-Policy']).toBeUndefined();
});

it('AD-11: no Sentry Replay anywhere', () => {
  for (const f of ['sentry.server.config.ts', 'src/instrumentation-client.ts', 'src/instrumentation.ts']) {
    expect(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')).not.toMatch(/replay/i);
  }
});

// The data-collection shape test was replaced by tests/unit/sentry-envelope.test.ts (T4.2.01a M1).
