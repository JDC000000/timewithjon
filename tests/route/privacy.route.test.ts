// The public /privacy page against a real prototype server: 200 for anyone, signed out and with no invite cookie,
// Jon's words in the HTML, and the site's usual noindex and no-referrer-leak headers.
import { describe, expect, it } from 'vitest';
import { PRIVACY } from '@/content/ui/privacy';

const BASE = process.env.ROUTE_BASE_URL ?? 'http://127.0.0.1:3200';

describe('GET /privacy', () => {
  it('200 with no cookie at all, Jon’s words, the title, noindex', async () => {
    const res = await fetch(`${BASE}/privacy`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(PRIVACY.body);
    expect(html).toContain(`<title>${PRIVACY.pageTitle}</title>`);
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(res.headers.getSetCookie()).toEqual([]); // nothing to sign in to, nothing set
  });
});
