// Review L3: the build fails unless APP_MODE is a real mode, so the browser Sentry environment is never empty
// (an empty one makes the SDK report "production").
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig, { buildAppMode } from '../../next.config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('APP_MODE at build time', () => {
  it.each(['prototype', 'staging', 'production'])('accepts %s', (mode) => {
    expect(buildAppMode(mode)).toBe(mode);
  });

  it.each([undefined, '', 'prod', 'Production'])('rejects %j', (mode) => {
    expect(() => buildAppMode(mode)).toThrow(/APP_MODE must be one of prototype, staging, production/);
  });

  it('fails a production build without APP_MODE, and builds with one', () => {
    vi.stubEnv('APP_MODE', '');
    expect(() => nextConfig(PHASE_PRODUCTION_BUILD)).toThrow(/APP_MODE/);
    vi.stubEnv('APP_MODE', 'staging');
    expect(nextConfig(PHASE_PRODUCTION_BUILD)).toHaveProperty('headers');
  });

  it('does not check outside a build (next start reads the inlined value)', () => {
    vi.stubEnv('APP_MODE', '');
    expect(() => nextConfig(PHASE_DEVELOPMENT_SERVER)).not.toThrow();
  });
});

describe('token pages (pr32-review L3)', () => {
  it('/manage, /offer and /new-date answer no-referrer + private, no-store, after the site-wide headers', async () => {
    const { baseConfig, TOKEN_PAGES } = await import('../../next.config');
    const rules = await baseConfig.headers!();
    expect(rules.map((r) => r.source)).toEqual([
      '/:path*',
      TOKEN_PAGES,
      '/admin/:path*',
      '/admin/auth/callback',
      '/img/:path*',
    ]);
    expect(rules[1]!.headers).toEqual([
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Cache-Control', value: 'private, no-store' },
    ]);
    for (const p of ['manage', 'offer', 'new-date'])
      expect(new RegExp(`^${TOKEN_PAGES}$`).test(`/${p}`)).toBe(true);
    expect(new RegExp(`^${TOKEN_PAGES}$`).test('/manages')).toBe(false);
  });
});

describe('admin pages (pr73-review F2)', () => {
  it('/admin and everything under it answer private, no-store, after the site-wide headers', async () => {
    const { baseConfig, ADMIN_PAGES } = await import('../../next.config');
    const rules = await baseConfig.headers!();
    const admin = rules.find((r) => r.source === ADMIN_PAGES)!;
    expect(ADMIN_PAGES).toBe('/admin/:path*');
    expect(rules.indexOf(admin)).toBeGreaterThan(rules.findIndex((r) => r.source === '/:path*'));
    expect(admin.headers).toEqual([{ key: 'Cache-Control', value: 'private, no-store' }]);
  });
});

describe('the emailed sign-in link page (pr75-review F1)', () => {
  it('/admin/auth/callback answers Referrer-Policy strict-origin, after the site-wide and admin headers', async () => {
    const { baseConfig, SIGN_IN_LINK_PAGE, ADMIN_PAGES } = await import('../../next.config');
    const rules = await baseConfig.headers!();
    const link = rules.find((r) => r.source === SIGN_IN_LINK_PAGE)!;
    expect(SIGN_IN_LINK_PAGE).toBe('/admin/auth/callback');
    expect(link.headers).toEqual([{ key: 'Referrer-Policy', value: 'strict-origin' }]);
    // later rules win: it must come after the site-wide same-origin policy and the admin no-store rule
    expect(rules.indexOf(link)).toBeGreaterThan(rules.findIndex((r) => r.source === '/:path*'));
    expect(rules.indexOf(link)).toBeGreaterThan(rules.findIndex((r) => r.source === ADMIN_PAGES));
  });
});
