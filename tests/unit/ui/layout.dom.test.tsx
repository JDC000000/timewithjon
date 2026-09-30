// tests/unit/ui/layout.dom.test.tsx (U1, pr74-review F2): the root layout passes the real APP_MODE to the staging
// banner: the note shows on staging only, and the layout needs nothing but APP_MODE to render.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ mode: 'prototype' as string }));
vi.mock('@/config/env', async (orig) => ({
  ...(await orig<typeof import('@/config/env')>()),
  getAppMode: () => m.mode,
  getEnv: () => {
    throw new Error('the root layout must not read the full env (it prerenders every page)');
  },
}));
// T4.1.05: the layout awaits connection() so every page renders per request (CSP nonce).
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('@/app/fonts', () => ({
  newsreader: { variable: 'f-newsreader' },
  schibsted: { variable: 'f-schibsted' },
}));

const { default: RootLayout } = await import('@/app/layout');

afterEach(() => {
  m.mode = 'prototype';
});

describe('RootLayout', () => {
  it.each(['prototype', 'staging', 'production'])(
    'APP_MODE=%s: the staging note only on staging',
    async (mode) => {
      m.mode = mode;
      const html = renderToStaticMarkup(await RootLayout({ children: <main id="main">Page</main> }));
      expect(html.includes('role="note"')).toBe(mode === 'staging');
      expect(html.includes('Staging. Test data only.')).toBe(mode === 'staging');
      expect(html).toContain('<a class="skip" href="#main">Skip to content</a>');
      expect(html).toContain('class="f-newsreader f-schibsted"');
    },
  );
});
