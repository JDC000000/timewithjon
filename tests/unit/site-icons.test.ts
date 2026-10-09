// UX-05 (ux-a11y-adversarial 2026-10-08; Jon approved the "J" mark 2026-10-09): the site icons and the share image are
// App Router files in src/app (Next serves them and writes the <link>/<meta> tags), and the layout's metadataBase is
// the site's own origin so og:image is absolute. The root layout still reads no more than it needs (getSiteUrl).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const APP = path.resolve(__dirname, '../../src/app');
const png = (f: string) => {
  const b = readFileSync(path.join(APP, f));
  expect(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), f).toBe(
    true,
  );
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

describe('site icons (UX-05)', () => {
  it('favicon.ico (16/32/48), icon.svg (no script), apple-icon.png 180, opengraph-image.png 1200 x 630 + alt', () => {
    const ico = readFileSync(path.join(APP, 'favicon.ico'));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3]);
    const svg = readFileSync(path.join(APP, 'icon.svg'), 'utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toMatch(/<script|on\w+=|href=/i);
    expect(png('apple-icon.png')).toEqual([180, 180]);
    expect(png('opengraph-image.png')).toEqual([1200, 630]);
    expect(readFileSync(path.join(APP, 'opengraph-image.alt.txt'), 'utf8')).toBe('Time with Jon');
  });
});

describe('r5 N-L10: /apple-touch-icon.png at the root', () => {
  it('rewrites to the App Router apple-icon.png (the same file; nothing new in public/)', async () => {
    const { baseConfig } = await import('../../next.config');
    expect(await baseConfig.rewrites?.()).toEqual([
      { source: '/apple-touch-icon.png', destination: '/apple-icon.png' },
    ]);
  });
});

describe('the layout metadata (UX-05)', () => {
  const env = process.env;
  afterEach(() => {
    process.env = env;
    vi.resetModules();
  });
  const load = async (site: string | undefined) => {
    process.env = { ...env, NEXT_PUBLIC_SITE_URL: site };
    vi.resetModules();
    vi.doMock('@/app/fonts', () => ({ newsreader: { variable: 'a' }, schibsted: { variable: 'b' } }));
    return (await import('@/app/layout')).generateMetadata();
  };
  it('metadataBase is the site origin; noindex and the share text stay', async () => {
    const m = await load('https://timewithjon.com');
    expect(m.metadataBase?.toString()).toBe('https://timewithjon.com/');
    expect(m.robots).toEqual({ index: false, follow: false });
    expect(m.openGraph?.title).toBe('Time with Jon');
  });
  it('no (or a bad) site URL: no metadataBase, never an error (a build with only APP_MODE set)', async () => {
    expect((await load(undefined)).metadataBase).toBeUndefined();
    expect((await load('https://x.example/')).metadataBase).toBeUndefined();
  });
});
