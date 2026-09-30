// INT-06 (VD9-09): a human-speed click (mouse down, ~90 ms, up) on every month tab, a tile and every Remove chip,
// right after focus sat in a field, always lands: the element under a pending pointer is never rebuilt mid-click.
// Scope: 320 / 375 / 768 / 1440 at 100 % (the 5 runs catch the intermittent loss).
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { clickLikeAPerson, humanClick, wheelTo } from '../support/input';
import { inScope, WIDTHS } from '../support/scope';
import { fixmeUnlessLanded, gotoScreen, type ScreenKey } from '../support/screens';

const PICKERS: ScreenKey[] = [
  's06-picker-open',
  's06-picker-spoken-for',
  's06-picker-away',
  's08-surprise-me',
  's10-details-send',
];

/** Put focus in a field first (the VD9-09 set-up): a blur re-render is what used to eat the click. */
async function focusAField(page: Page): Promise<void> {
  const field = page.getByRole('textbox').first();
  if (await field.count()) await clickLikeAPerson(page, field);
}

// Only this case's part of the matrix (support/scope.ts); options only, so skipped runs start no browser page.
test.skip(
  ({ viewport, textMode }) => !inScope(viewport, textMode, { viewports: WIDTHS, textModes: ['t100'] }),
  'INT-06 runs at 100 %',
);

for (const key of PICKERS) {
  test(`INT-06 ${key}: human-speed clicks on month tabs, a tile and Remove chips all land`, async ({
    page,
  }) => {
    fixmeUnlessLanded(test.fixme, [key]);
    await gotoScreen(page, key);
    const lost: string[] = [];
    const click = async (target: ReturnType<Page['getByRole']>) => {
      await focusAField(page);
      await wheelTo(page, target);
      await humanClick(page, target);
    };

    const tabs = page.getByRole('tab');
    for (let i = 0; i < (await tabs.count()); i++) {
      const tab = tabs.nth(i);
      if ((await tab.getAttribute('aria-selected')) === 'true') continue;
      await click(tab);
      if ((await tab.getAttribute('aria-selected')) !== 'true') lost.push(`tab ${await tab.textContent()}`);
    }
    const tiles = page.getByRole('tabpanel').getByRole('button');
    const index = await tiles.evaluateAll((all) =>
      all.findIndex((b) => b.getAttribute('aria-pressed') === 'false' && !(b as HTMLButtonElement).disabled),
    );
    if (index >= 0) {
      await click(tiles.nth(index));
      if ((await tiles.nth(index).getAttribute('aria-pressed')) !== 'true') lost.push(`tile ${index + 1}`);
    }
    const chips = page.getByRole('button', { name: /^Remove / });
    for (let k = 0; k < 3 && (await chips.count()); k++) {
      const before = await chips.count();
      const chip = chips.first();
      if (!(await chip.isVisible())) break;
      await click(chip);
      if ((await chips.count()) !== before - 1) lost.push(`Remove chip ${k + 1}`);
    }
    expect(lost, 'clicks that did not land').toEqual([]);
  });
}
