// T4.6.04: the voice typeface keeps its italic after the italic stopped loading with the page (src/ui/late-italic.ts).
// Once the page has loaded, the family --font-newsreader names has a loaded roman AND italic Newsreader face (or
// italic text would stay a slanted roman), and only the roman and the UI face are preloaded. Checked on /menu, whose
// course headings are italic voice text: the browser fetches the face only for a page that shows italic (the
// landing no longer does since its closing line went, 2026-10-05).
import { expect, test } from './support/fixtures';

test('the voice family gets its italic face after load, and only the roman is preloaded', async ({
  page,
}) => {
  await page.goto('/menu');
  const preloads = await page
    .locator('head link[rel="preload"][as="font"]')
    .evaluateAll((links) => links.map((l) => l.getAttribute('href') ?? ''));
  expect(preloads).toHaveLength(2);
  expect(preloads.some((href) => href.includes('newsreader_roman'))).toBe(true);
  expect(preloads.some((href) => href.includes('italic'))).toBe(false);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const family = getComputedStyle(document.documentElement)
          .getPropertyValue('--font-newsreader')
          .split(',')[0]!
          .trim()
          .replace(/['"]/g, '');
        return [...document.fonts]
          .filter((f) => f.family.replace(/['"]/g, '') === family && f.status === 'loaded')
          .map((f) => f.style)
          .sort();
      }),
    )
    .toEqual(['italic', 'normal']);
});
