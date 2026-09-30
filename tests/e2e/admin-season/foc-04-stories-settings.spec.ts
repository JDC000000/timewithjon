// tests/e2e/admin-season/foc-04-stories-settings.spec.ts (lane U6, T2.9.U1 / T3.7.U1 / T3.3.U1): FOC-04 "focus lands
// visibly" on A6 stories and A7 settings under REAL input only (page.keyboard; never element.focus() or injected
// state), text size set before load, 375 and 1440, run per engine (Chromium, then WebKit). After navigation, reload,
// Back, a failed submit, a submit that navigates and a save, document.activeElement is the sensible element, fully
// inside the viewport. Needs the seeded stories (Priya, Alex) and a signed-in admin (./admin.ts fakeAdmin).
import { expect, test, type Page } from '@playwright/test';
import { fakeAdmin, landedOn, open, tabTo, TEXT, WIDTHS } from './admin';

test.describe.configure({ mode: 'serial' });
fakeAdmin();

/** The row link for a story (its name reads "Priya, sent by email, OK for the book"). */
const storyRow = (page: Page, name: string) => page.getByRole('link', { name: new RegExp(`^${name}\\b`) });

for (const width of WIDTHS) {
  for (const scale of TEXT) {
    test.describe(`FOC-04 A6/A7 at ${width} px, ${scale * 100} % text`, () => {
      test.use({ viewport: { width, height: width < 600 ? 740 : 900 } });

      test('A6: a story opened by keyboard, reloaded, then Back lands on its row', async ({ page }) => {
        await open(page, '/admin/stories', scale);
        const row = storyRow(page, 'Priya');
        await tabTo(page, row);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/admin\/stories\/[0-9a-f-]{36}$/, { timeout: 15_000 });
        const title = page.getByRole('heading', { name: 'Priya', level: 2 });
        await landedOn(page, title);
        await page.reload();
        await landedOn(page, title);
        await page.goBack();
        await expect(page).toHaveURL(/\/admin\/stories$/, { timeout: 15_000 });
        await landedOn(page, storyRow(page, 'Priya'));
      });

      test('A6: Add emailed story, an empty send lands on "Things to fix"; a good one on the new story', async ({
        page,
      }) => {
        await open(page, '/admin/stories', scale);
        await tabTo(page, page.getByRole('button', { name: 'Add emailed story' }));
        await page.keyboard.press('Enter');
        const sheet = page.getByRole('dialog');
        await landedOn(page, sheet.getByRole('heading', { name: 'Add emailed story' }));
        await tabTo(page, sheet.getByRole('button', { name: 'Add to the book pile' }));
        await page.keyboard.press('Enter');
        await landedOn(page, sheet.getByRole('heading', { name: 'Three things to fix' }).locator('..'));
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        const name = sheet.getByLabel('From (name)');
        await landedOn(page, name);
        const who = `Dana ${width}x${scale}`;
        await page.keyboard.type(who);
        await page.keyboard.press('Tab');
        await page.keyboard.type('dana@example.com');
        await page.keyboard.press('Tab');
        await page.keyboard.type('The van with no reverse gear.');
        await tabTo(page, sheet.getByRole('button', { name: 'Add to the book pile' }));
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/admin\/stories\/[0-9a-f-]{36}$/, { timeout: 15_000 });
        await landedOn(page, page.getByRole('heading', { name: who, level: 2 }));
      });

      test('A7: opening times by keyboard; a save keeps focus on Save, in view', async ({ page }) => {
        await open(page, '/admin/settings/opening-times', scale);
        await landedOn(page, page.getByRole('heading', { name: 'Opening times', level: 2 }));
        const save = page.getByRole('button', { name: 'Save' });
        await tabTo(page, save);
        await page.keyboard.press('Enter');
        await expect(page.getByText('Nothing changed.', { exact: true }).first()).toBeAttached();
        await landedOn(page, save);
      });

      test('A7: Calendar by keyboard from the groups; reload lands on its title', async ({ page }) => {
        await open(page, '/admin/settings', scale);
        const group = page.getByRole('link', { name: 'Calendar', exact: true });
        await tabTo(page, group);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/admin\/settings\/calendar$/, { timeout: 15_000 });
        const title = page.getByRole('heading', { name: 'Calendar', level: 2 });
        await landedOn(page, title);
        await page.reload();
        await landedOn(page, title);
      });
    });
  }
}
