// INT-04 (VD7-07 / REFLOW200): no phone screen scrolls sideways at 200 % text (or 1.4.12 + 125 %), and no date word
// breaks across two lines (a weekday may wrap away from its date). Every screen; phones × 200 % / 1.4.12 + 125 %.
import { expect, test } from '../support/fixtures';
import { settle } from '../support/input';
import { horizontalOverflow } from '../support/layout';
import { splitDateWords } from '../support/layout-probes';
import { inScope, PHONES } from '../support/scope';
import { fixmeUnlessLanded, gotoScreen, SCREENS, type ScreenKey } from '../support/screens';

// Only this case's part of the matrix (support/scope.ts); options only, so skipped runs start no browser page.
test.skip(
  ({ viewport, textMode }) =>
    !inScope(viewport, textMode, { viewports: PHONES, textModes: ['t200', 'sp125'] }),
  'INT-04 runs on phones at 200 % and 1.4.12 + 125 %',
);

for (const key of Object.keys(SCREENS) as ScreenKey[]) {
  test(`INT-04 ${key}: reflows at big text: no sideways scroll, no split dates`, async ({ page }) => {
    fixmeUnlessLanded(test.fixme, [key]);
    await gotoScreen(page, key);
    await settle(page);
    expect(await horizontalOverflow(page), 'no sideways scroll').toBe(0);
    expect(await page.evaluate(splitDateWords), 'date words split across lines').toEqual([]);
  });
}
