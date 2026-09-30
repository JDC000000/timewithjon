// FOC-02 (VD9-02): after Back and after a reload (the guest had scrolled), a full Tab walk and a full Shift+Tab walk
// stop 0 times on a control hidden outside the viewport (or its scroller) or under another element, on the picker
// (open), the spoken-for view and the request form. Scope: 320 / 375 × 200 % and 1.4.12 + 125 % text.
import { expect, test } from '../support/fixtures';
import { isNotHidden, tabWalk } from '../support/focus-probe';
import { goBack, sendRequest } from '../support/flows';
import { settle, wheel } from '../support/input';
import { inScope, TALL_PHONES } from '../support/scope';
import { fixmeUnlessLanded, gotoScreen, type ScreenKey } from '../support/screens';

const PAGES: ScreenKey[] = ['s06-picker-open', 's06-picker-spoken-for', 's10-details-send'];

// Only this case's part of the matrix (support/scope.ts); options only, so skipped runs start no browser page.
test.skip(
  ({ viewport, textMode }) =>
    !inScope(viewport, textMode, { viewports: TALL_PHONES, textModes: ['t200', 'sp125'] }),
  'FOC-02 runs on 320 / 375 at 200 % and 1.4.12 + 125 %',
);

for (const key of PAGES) {
  for (const after of ['Back', 'a reload'] as const) {
    test(`FOC-02 ${key} after ${after}: no Tab or Shift+Tab stop is hidden`, async ({ page }) => {
      fixmeUnlessLanded(test.fixme, after === 'Back' ? [key, 's11-after-send'] : [key]);
      await gotoScreen(page, key);
      await wheel(page, 700);
      if (after === 'Back') {
        await sendRequest(page);
        await goBack(page);
      } else {
        await page.reload();
      }
      await settle(page);
      const forward = await tabWalk(page, 'Tab');
      const backward = await tabWalk(page, 'Shift+Tab', 90);
      expect(forward.length, 'the walk reaches the page').toBeGreaterThan(3);
      const hidden = [...forward, ...backward].filter((stop) => !isNotHidden(stop));
      expect(hidden, `hidden stops: ${JSON.stringify(hidden)}`).toEqual([]);
    });
  }
}
