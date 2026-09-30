// tests/e2e/a11y/axe.spec.ts — T1.11.U2 / TSD T1.11 AC2 ("axe is clean"): @axe-core/playwright with the WCAG 2.2 AA
// tags on every main screen of the prototype, one test per screen, in every smoke project (Chromium + WebKit, 375 +
// 1440). Screens are opened the way a visitor reaches them: the seeded guest / stand-in admin of support/sessions.ts,
// or rows this spec seeds for itself (tests/e2e/a11y/axe.ts). A real app violation is a test.fixme naming the screen
// and the axe rule, listed as a follow-up in the PR; delete the fixme when the fix lands.
import type { Page } from '@playwright/test';
import { SCREENS } from '../support/screens';
import { signInAs } from '../support/sessions';
import { expect, test } from '../support/fixtures';
import { expectAxeClean, manageToken, ownInvite, ownRequest, signedCookie } from './axe';

async function open(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), `GET ${path}`).toBe(200);
  await expect(page.locator('main').first()).toBeVisible();
}

test.describe('guest screens', () => {
  test('S01 landing (/)', async ({ page }) => {
    await open(page, SCREENS['s01-landing'].app);
    await expectAxeClean(page);
  });

  test('S02 personal landing (/ with an invite)', async ({ page, baseURL }) => {
    await signInAs(page.context(), 'guest', baseURL!);
    await open(page, SCREENS['s02-personal-link'].app);
    await expectAxeClean(page);
  });

  test('S04 menu (/menu)', async ({ page }) => {
    await open(page, SCREENS['s04-menu'].app);
    await expectAxeClean(page);
  });

  test('S05 dish sheet (/menu#the-long-lunch)', async ({ page }) => {
    await open(page, SCREENS['s05-dish-sheet'].app);
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    // The sheet opens with a `sheet-up` opacity 0 -> 1 animation (site.css). axe measures colour contrast through
    // that opacity, so a run mid-animation reports color-contrast on the sheet header (seen on WebKit, CI run
    // 36668523248). Wait for the sheet's own finite animations to finish; no fixed delay.
    await sheet.evaluate((el) =>
      Promise.all(
        el
          .getAnimations({ subtree: true })
          .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime ?? Infinity)))
          .map((a) => a.finished.catch(() => undefined)),
      ),
    );
    await expectAxeClean(page);
  });

  test('S06 picker (/book/<picker dish>)', async ({ page, baseURL }) => {
    await signInAs(page.context(), 'guest', baseURL!);
    await open(page, SCREENS['s06-picker-open'].app);
    await expectAxeClean(page);
  });

  test('S08 Surprise Me (/book/<surprise dish>)', async ({ page, baseURL }) => {
    await signInAs(page.context(), 'guest', baseURL!);
    await open(page, SCREENS['s08-surprise-me'].app);
    await expectAxeClean(page);
  });

  test('S11 after send (/sent)', async ({ page, baseURL }) => {
    const { requestId } = await ownRequest();
    await signedCookie(page, baseURL, 'req', requestId);
    await open(page, '/sent');
    await expectAxeClean(page);
  });

  test('S12b wine tag (/tag)', async ({ page }) => {
    await open(page, '/tag');
    await expectAxeClean(page);
  });

  test('S17 manage my booking (/manage?t=)', async ({ page }) => {
    const { requestId } = await ownRequest();
    await open(page, `/manage?t=${encodeURIComponent(await manageToken(requestId))}`);
    await expectAxeClean(page);
  });

  test('S17b manage, expired link (/manage?t=)', async ({ page }) => {
    const { requestId } = await ownRequest();
    await open(page, `/manage?t=${encodeURIComponent(await manageToken(requestId, true))}`);
    await expectAxeClean(page);
  });

  test('S19 send a story (/story with an invite)', async ({ page, baseURL }) => {
    await signedCookie(page, baseURL, 'invite', await ownInvite());
    await open(page, '/story');
    await expectAxeClean(page);
  });

  test('S16 stale link (/story without an invite)', async ({ page }) => {
    await open(page, '/story');
    await expectAxeClean(page);
  });
});

test.describe('admin screens', () => {
  test('A1 sign-in (/admin/sign-in)', async ({ page }) => {
    await open(page, SCREENS['a1-sign-in'].app);
    await expectAxeClean(page);
  });

  const signedIn: [string, string][] = [
    ['A2 requests', SCREENS['a2-requests'].app],
    ['A4 season', SCREENS['a4-season'].app],
    ['A4b week', SCREENS['a4b-week'].app],
    ['A4c away', SCREENS['a4c-away'].app],
    ['A6 stories', '/admin/stories'],
    ['A7 settings', '/admin/settings'],
    ['A7b opening times', '/admin/settings/opening-times'],
    ['A7c replies and stories', '/admin/settings/replies'],
    ['A7d calendar', '/admin/settings/calendar'],
  ];
  for (const [name, path] of signedIn) {
    test(`${name} (${path})`, async ({ page, baseURL }) => {
      await signInAs(page.context(), 'admin', baseURL!);
      await open(page, path);
      await expectAxeClean(page);
    });
  }

  test('A3 request detail (/admin/requests/<id>)', async ({ page, baseURL }) => {
    const { requestId } = await ownRequest();
    await signInAs(page.context(), 'admin', baseURL!);
    await open(page, `/admin/requests/${requestId}`);
    await expectAxeClean(page);
  });
});
