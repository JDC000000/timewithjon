// FOC-03 (VD9-03, t4.3-carryover-focus-cases.md): with the desktop ⋯ menu open, Tab from the last item and
// Shift+Tab from the first close it and move focus to the control after / before ⋯; Esc closes it and returns to ⋯.
// Never the skip link. Real keys only. The ⋯ is a menu from 600 px up (below, it opens a sheet: FOC-04/05 cover it).
import { expect, test } from '../support/fixtures';
import { focusState, isSeen } from '../support/focus-probe';
import { press } from '../support/input';
import { fixmeUnlessLanded, gotoScreen, type ScreenKey } from '../support/screens';

// a3b shows no ⋯ while the lock is sending; the sheet state (a3c) is FOC-04/05's.
const SCREENS_WITH_MENU: ScreenKey[] = ['a3-request-detail'];
const MENU_BUTTON = { name: /^More for / };

// Options only, so skipped runs start no browser page.
test.skip(({ viewport }) => (viewport?.width ?? 0) < 600, 'the ⋯ is a sheet under 600 px');

const cases = [
  { key: 'Tab', from: 'last', expect: 'next' },
  { key: 'Shift+Tab', from: 'first', expect: 'previous' },
  { key: 'Tab', from: 'first', expect: 'next' },
  { key: 'Escape', from: 'last', expect: 'button' },
] as const;

for (const screen of SCREENS_WITH_MENU) {
  for (const c of cases) {
    test(`FOC-03 ${screen}: ${c.key} from the ${c.from} item closes the ⋯ menu, focus goes to the ${c.expect} control`, async ({
      page,
    }) => {
      fixmeUnlessLanded(test.fixme, [screen]);
      await gotoScreen(page, screen);
      const button = page.getByRole('button', MENU_BUTTON);
      const isFocused = () => button.evaluate((el) => el === document.activeElement);

      // Reach ⋯ the way a person does: Tab through the page.
      for (let i = 0; i < 80 && !(await isFocused()); i++) await press(page, 'Tab');
      expect(await isFocused(), 'Tab reaches the ⋯ button').toBe(true);

      // Learn its neighbours in the page's Tab order, with real keys.
      await press(page, 'Tab');
      const next = (await focusState(page))?.name;
      await press(page, 'Shift+Tab');
      await press(page, 'Shift+Tab');
      const previous = (await focusState(page))?.name;
      await press(page, 'Tab');
      expect(await isFocused()).toBe(true);

      await press(page, 'Enter');
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem').first()).toBeFocused();
      if (c.from === 'last') {
        await press(page, 'End');
        await expect(menu.getByRole('menuitem').last()).toBeFocused();
      }

      await press(page, c.key);
      await expect(menu).toBeHidden();
      const landed = await focusState(page);
      // No control after (or before) ⋯ in the page: focus stays on ⋯ rather than leaving the page.
      const want = c.expect === 'next' ? next : c.expect === 'previous' ? previous : undefined;
      if (want === undefined) expect(await isFocused(), 'focus is back on ⋯').toBe(true);
      else expect(landed?.name).toBe(want);
      expect(landed?.name ?? '').not.toMatch(/^Skip/);
      expect(isSeen(landed), `focus is on screen and uncovered: ${JSON.stringify(landed)}`).toBe(true);
    });
  }
}
