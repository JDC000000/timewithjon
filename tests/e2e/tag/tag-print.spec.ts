// T4.6.05 (auto part) + T1.9 AC1: the S12b wine tag sheet (/tag) prints as ONE Letter page holding the four tags,
// each at true size, 2.5 × 4 in within ±2 mm (TSD T4.6 AC4). Print media is emulated and each tag is measured with
// getBoundingClientRect at CSS's 96 px/in; page.pdf (Letter) proves the page count. page.pdf is Chromium-only, so
// the file runs in the Chromium projects of the app target only. The physical print on real stock (J.24) is Jon's.
import { TAG_UI } from '../../../src/content/ui/tag';
import { expect, test } from '../support/fixtures';
import { TARGET } from '../support/screens';

const PX_PER_IN = 96; // CSS reference pixel: 1in = 96px
const TOL_PX = (2 / 25.4) * PX_PER_IN; // ±2 mm ≈ 7.56 px
const LETTER = { w: 8.5 * PX_PER_IN, h: 11 * PX_PER_IN }; // 816 × 1056 px
const TAG = { w: 2.5 * PX_PER_IN, h: 4 * PX_PER_IN }; // 240 × 384 px
const PT_PER_IN = 72; // PDF user space

test.skip(
  ({ browserName }) => browserName !== 'chromium' || TARGET !== 'app',
  'page.pdf is Chromium-only; /tag is an app route',
);

test('T1.9 AC1 / T4.6 AC4: /tag prints 4 tags on 1 Letter page, each 2.5 × 4 in ±2 mm', async ({ page }) => {
  await page.goto('/tag');
  const sheet = page.getByRole('img', { name: TAG_UI.sheetLabel });
  await expect(sheet).toBeVisible();

  await page.emulateMedia({ media: 'print' });
  const tags = sheet.locator('.tag');
  await expect(tags).toHaveCount(4);

  const boxes = await tags.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
    }),
  );
  for (const [i, b] of boxes.entries()) {
    expect(Math.abs(b.w - TAG.w), `tag ${i + 1} width ${b.w}px vs ${TAG.w}px (2.5 in)`).toBeLessThanOrEqual(
      TOL_PX,
    );
    expect(Math.abs(b.h - TAG.h), `tag ${i + 1} height ${b.h}px vs ${TAG.h}px (4 in)`).toBeLessThanOrEqual(
      TOL_PX,
    );
    // Each tag sits wholly inside the first Letter page (the print CSS starts the sheet at the page's top-left).
    expect(b.x, `tag ${i + 1} left edge on the page`).toBeGreaterThanOrEqual(0);
    expect(b.y, `tag ${i + 1} top edge on the page`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w, `tag ${i + 1} right edge on the page`).toBeLessThanOrEqual(LETTER.w);
    expect(b.y + b.h, `tag ${i + 1} bottom edge on the page`).toBeLessThanOrEqual(LETTER.h);
  }
  // Four distinct places: a 2 × 2 grid, no two tags stacked on each other.
  const spots = new Set(boxes.map((b) => `${Math.round(b.x)},${Math.round(b.y)}`));
  expect(spots.size, 'four distinct tag positions').toBe(4);

  // The sheet itself is the Letter page: 8.5 × 11 in.
  const sheetBox = await page.locator('.sheet-letter').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  expect(Math.abs(sheetBox.w - LETTER.w), `sheet width ${sheetBox.w}px`).toBeLessThanOrEqual(TOL_PX);
  expect(Math.abs(sheetBox.h - LETTER.h), `sheet height ${sheetBox.h}px`).toBeLessThanOrEqual(TOL_PX);

  // The real print: exactly one Letter page (612 × 792 pt).
  const pdf = (await page.pdf({ format: 'Letter' })).toString('latin1');
  const pages = pdf.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? [];
  expect(pages.length, 'PDF page count').toBe(1);
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
  expect(box, 'the page has a MediaBox').not.toBeNull();
  expect(Number(box?.[1])).toBeCloseTo(8.5 * PT_PER_IN, 0);
  expect(Number(box?.[2])).toBeCloseTo(11 * PT_PER_IN, 0);
});
