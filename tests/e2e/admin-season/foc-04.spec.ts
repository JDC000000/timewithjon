// tests/e2e/admin-season/foc-04.spec.ts (lane U6, T2.5.U1): FOC-04 "focus lands visibly" on A4 / A4b / A4c under
// REAL input only (page.keyboard / page.mouse; never element.focus() or injected state), text size set before load,
// Chromium AND WebKit (U7's projects), 375 and 1440. After navigation, reload, Back, a failed submit and a save,
// document.activeElement is the sensible element, fully inside the viewport.
//
// Needs a signed-in admin (./admin.ts fakeAdmin). The server under test must run with FEATURE_ADMIN_AUTH=1 and SUPABASE_URL pointing at the
// stand-in Auth this spec starts (E2E_FAKE_AUTH_PORT, default 54999; it answers GET /auth/v1/user for ADMIN_EMAILS'
// jon@example.com and nothing else), against a loopback test DB (pnpm db:test). Skipped unless E2E_ADMIN=fake-auth.
import { expect, test } from '@playwright/test';
import { fakeAdmin, landedOn, open, tabTo, TEXT, WIDTHS } from './admin';

test.describe.configure({ mode: 'serial' }); // the off/on case edits the one away range
fakeAdmin();

/** The seeded away range the cases start from and put back. */
const AWAY = { from: '2027-04-24', to: '2027-05-03', confirmBy: '2027-05-05' };

for (const width of WIDTHS) {
  for (const scale of TEXT) {
    test.describe(`FOC-04 A4 at ${width} px, ${scale * 100} % text`, () => {
      test.use({ viewport: { width, height: width < 600 ? 740 : 900 } });

      test('A4c: arriving by keyboard and by reload lands on the title', async ({ page }) => {
        await open(page, '/admin/season', scale);
        const edit = page.getByRole('link', { name: /^Edit\s*away mode$/ });
        await tabTo(page, edit);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/admin\/season\/away$/, { timeout: 15_000 });
        const title = page.getByRole('heading', { name: 'Away mode', level: 2 });
        await landedOn(page, title);
        await page.reload();
        await landedOn(page, title);
      });

      test('A4c: off lands on the card; an empty submit lands on "Things to fix", its link on the field', async ({
        page,
        baseURL,
      }) => {
        await open(page, '/admin/season/away', scale);
        await expect(page.getByRole('heading', { name: 'Away mode', level: 2 })).toBeFocused(); // hydrated
        try {
          await page.getByRole('button', { name: 'Turn away mode off' }).click();
          await expect(page).toHaveURL(/\/admin\/season$/, { timeout: 15_000 });
          const edit = page.getByRole('link', { name: /^Edit\s*away mode$/ });
          await landedOn(page, edit);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/\/admin\/season\/away$/, { timeout: 15_000 });
          await landedOn(page, page.getByRole('heading', { name: 'Away mode', level: 2 }));
          await tabTo(page, page.getByRole('button', { name: 'Save away mode' }));
          await page.keyboard.press('Enter');
          const sum = page.getByRole('heading', { name: 'Two things to fix' }).locator('..');
          await landedOn(page, sum);
          await page.keyboard.press('Tab');
          await page.keyboard.press('Enter');
          await landedOn(page, page.getByLabel('From'));
        } finally {
          // put the range back for the next case (a fixture write through the admin API, not page state)
          await page.request.post('/api/admin/season/blocks', {
            headers: { origin: baseURL! },
            data: { startDate: AWAY.from, endDate: AWAY.to, kind: 'away', confirmBy: AWAY.confirmBy },
          });
        }
      });

      test('A4c: a save goes back to the list and lands on the away card', async ({ page }) => {
        await open(page, '/admin/season/away', scale);
        await expect(page.getByRole('heading', { name: 'Away mode', level: 2 })).toBeFocused(); // hydrated
        // the saved range, saved again: no write, the same landing
        await page.getByRole('button', { name: 'Save away mode' }).click();
        await expect(page).toHaveURL(/\/admin\/season$/, { timeout: 15_000 }); // client-side: no load event
        await landedOn(page, page.getByRole('link', { name: /^Edit\s*away mode$/ }));
      });

      test('A4b: arriving lands on the week title; Back lands on its row', async ({ page }) => {
        await open(page, '/admin/season', scale);
        const row = page.getByRole('link', { name: /^Week of\s*May 17\b/ });
        await tabTo(page, row);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/admin\/season\/week\/2027-05-17$/, { timeout: 15_000 });
        await landedOn(page, page.getByRole('heading', { level: 2 }).first());
        await page.goBack();
        await expect(page).toHaveURL(/\/admin\/season$/, { timeout: 15_000 }); // client-side: no load event
        await landedOn(page, row);
      });
    });
  }
}
