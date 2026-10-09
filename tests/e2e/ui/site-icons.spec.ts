// UX-05: the site icons are served and linked, and og:image is absolute (metadataBase). Real server, both engines.
import { expect, test } from '@playwright/test';

test('favicon, icon, apple icon and og:image are served and linked', async ({ page, request, baseURL }) => {
  for (const [p, type] of [
    ['/favicon.ico', 'image/'],
    ['/icon.svg', 'image/svg+xml'],
    ['/apple-icon.png', 'image/png'],
    ['/opengraph-image.png', 'image/png'],
  ] as const) {
    const res = await request.get(p);
    expect(res.status(), p).toBe(200);
    expect(res.headers()['content-type'], p).toContain(type);
  }
  await page.goto('/');
  await expect(page.locator('head link[rel="icon"][href*="icon.svg"]')).toHaveCount(1);
  await expect(page.locator('head link[rel="apple-touch-icon"]')).toHaveCount(1);
  const og = await page.locator('head meta[property="og:image"]').first().getAttribute('content');
  expect(og?.startsWith(`${baseURL}/opengraph-image.png`)).toBe(true);
  await expect(page.locator('head meta[property="og:image:alt"]')).toHaveAttribute(
    'content',
    'Time with Jon',
  );
});
