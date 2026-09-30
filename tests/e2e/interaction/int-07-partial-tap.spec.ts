// INT-07 (VD10-02): a real tap/click on a control that is only partly in view activates it and does not scroll the
// page first; keep-visible scrolling runs for keyboard/script focus only, never for pointer focus.
// Scope: 320 / 375 × 100 % and 200 %.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { humanClickAt, scrollStill, wheel } from '../support/input';
import { inScope, TALL_PHONES } from '../support/scope';
import { fixmeUnlessLanded, gotoScreen } from '../support/screens';

/** The centre of the visible slice of a control cut by the viewport's top edge, if that slice is uncovered. */
async function partialSlice(target: Locator): Promise<{ x: number; y: number; share: number } | null> {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const visible = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    const share = visible / r.height;
    if (share <= 0.1 || share >= 0.9) return null;
    const x = r.left + r.width / 2;
    const y = Math.max(r.top, 0) + visible / 2;
    const hit = document.elementFromPoint(x, y);
    return hit && el.contains(hit) ? { x, y, share } : null;
  });
}

/** Wheel so that one of `candidates` straddles the top edge (S6's sticky bar owns the bottom one), slice uncovered. */
async function straddle(page: Page, candidates: Locator) {
  for (let i = 0; i < (await candidates.count()); i++) {
    const tile = candidates.nth(i);
    const box = await tile.boundingBox();
    if (!box) continue;
    await wheel(page, Math.round(box.y + box.height / 2));
    const slice = await partialSlice(tile);
    if (slice) return { tile, slice };
  }
  return null;
}

// Only this case's part of the matrix (support/scope.ts); options only, so skipped runs start no browser page.
test.skip(
  ({ viewport, textMode }) =>
    !inScope(viewport, textMode, { viewports: TALL_PHONES, textModes: ['t100', 't200'] }),
  'INT-07 runs on 320 / 375 at 100 % and 200 %',
);

test('INT-07 S6: a click on a half-visible tile (cut by the top edge) picks it without scrolling the page', async ({
  page,
}) => {
  fixmeUnlessLanded(test.fixme, ['s06-picker-open']);
  await gotoScreen(page, 's06-picker-open');
  const found = await straddle(page, page.getByRole('tabpanel').getByRole('button', { disabled: false }));
  expect(found, 'a tile can sit half in view at the bottom edge').not.toBeNull();
  if (!found) return;
  const pressed = await found.tile.getAttribute('aria-pressed');
  const before = await page.evaluate(() => scrollY);
  await humanClickAt(page, found.slice.x, found.slice.y);
  await scrollStill(page);
  expect(await page.evaluate(() => scrollY), 'the page did not scroll').toBe(before);
  expect(await found.tile.getAttribute('aria-pressed'), 'the tap landed').not.toBe(pressed);
});
