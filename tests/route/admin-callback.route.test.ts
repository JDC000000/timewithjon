// pr75-review F1: the emailed sign-in link page, served by a real prototype server: the token_hash in its URL never
// leaves in a Referer (strict-origin: bare origin only), and the page is never cached. The header comes from
// next.config.ts, so it holds even while FEATURE_ADMIN_AUTH is off (a 404 page).
import { describe, expect, it } from 'vitest';

const BASE = process.env.ROUTE_BASE_URL ?? 'http://127.0.0.1:3200';

describe('GET /admin/auth/callback (A1c)', () => {
  it('answers Referrer-Policy strict-origin and private, no-store', async () => {
    const res = await fetch(`${BASE}/admin/auth/callback?token_hash=${'a'.repeat(56)}&type=email`, {
      redirect: 'manual',
    });
    expect(res.headers.get('referrer-policy')).toBe('strict-origin');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
  it('the rest of the site keeps same-origin', async () => {
    const res = await fetch(`${BASE}/robots.txt`);
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
  });
});
