// INT-05 (VD7-01): the tick on a picked tile never touches or overlaps its time label, at every width and text size.
import { expect, test } from '../support/fixtures';
import { clickLikeAPerson } from '../support/input';
import { tickGaps } from '../support/layout-probes';
import { fixmeUnlessLanded, gotoScreen, type ScreenKey } from '../support/screens';

const PICKERS: ScreenKey[] = ['s06-picker-open', 's10-details-send'];

for (const key of PICKERS) {
  test(`INT-05 ${key}: a picked tile's tick keeps clear of its label`, async ({ page }) => {
    fixmeUnlessLanded(test.fixme, [key]);
    await gotoScreen(page, key);
    const panel = page.getByRole('tabpanel');
    await clickLikeAPerson(page, panel.getByRole('button', { pressed: false, disabled: false }).first());
    const gaps = await panel.getByRole('button', { pressed: true }).evaluateAll(tickGaps);
    expect(gaps.length, 'there are picked tiles').toBeGreaterThan(0);
    for (const g of gaps) {
      expect(g.gap, `the tick is found and clear of the label: ${JSON.stringify(gaps)}`).not.toBeNull();
      expect(g.gap ?? 0, `the tick is clear of the label: ${JSON.stringify(gaps)}`).toBeGreaterThanOrEqual(1);
    }
  });
}
