// INT-03 (VD6-03, VD5-06): an undone lock stays undone after a reload; once the invite has gone out, a reload and
// Back both show the locked state (no new countdown). Scope: 375 + 1440 at 100 % (state, not layout).
import { expect, test } from '../support/fixtures';
import { goBack, lockIn, TOAST_UNDO } from '../support/flows';
import { landLock } from '../support/lock-landing';
import { clickLikeAPerson, settle } from '../support/input';
import { inScope } from '../support/scope';
import { fixmeUnlessLanded, gotoScreen } from '../support/screens';

const SCOPE = { viewports: ['w375', 'w1440'], textModes: ['t100'] } as const;
const LOCK_IN = { name: /^Lock in/ };

// Only this case's part of the matrix (support/scope.ts); options only, so skipped runs start no browser page.
test.skip(
  ({ viewport, textMode }) => !inScope(viewport, textMode, SCOPE),
  'INT-03 runs on 375 + 1440 at 100 %',
);

test('INT-03 A3b: Undo, then reload: the lock stays undone', async ({ page }) => {
  fixmeUnlessLanded(test.fixme, ['a3-request-detail', 'a3b-lock-undo']);
  await gotoScreen(page, 'a3-request-detail');
  await lockIn(page);
  await page.waitForTimeout(650); // Undo ignores taps for 600 ms
  await clickLikeAPerson(page, page.getByRole('button', TOAST_UNDO));
  await expect(page.getByRole('button', LOCK_IN)).toBeVisible();
  await page.reload();
  await settle(page);
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', TOAST_UNDO), 'no new countdown after the reload').toHaveCount(0);
  await expect(page.getByRole('button', LOCK_IN)).toBeVisible();
});

test('INT-03 A3b: after the invite goes out, reload and Back show the locked state', async ({ page }) => {
  fixmeUnlessLanded(test.fixme, ['a3-request-detail', 'a3b-lock-undo', 'a2-requests']);
  test.setTimeout(60_000);
  await gotoScreen(page, 'a3-request-detail');
  // The invite goes out: the undo window, then the round trip, each within its own bound (support/lock-landing.ts).
  await landLock(page, test.info(), () => lockIn(page));
  await expect(page.getByRole('button', TOAST_UNDO)).toHaveCount(0);
  const lockedTitle = await page.title();
  await page.reload();
  await settle(page);
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', TOAST_UNDO), 'a reload starts no new countdown').toHaveCount(0);
  expect(await page.title()).toBe(lockedTitle);
  // Away to the requests list, then the browser's Back: the locked state again, like the reload.
  const url = page.url();
  await clickLikeAPerson(
    page,
    page
      .getByRole('link', { name: /^(‹ )?Requests/ })
      .filter({ visible: true })
      .first(),
  );
  await page.waitForURL((next) => next.toString() !== url);
  await goBack(page);
  await settle(page);
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', TOAST_UNDO), 'Back starts no new countdown').toHaveCount(0);
  expect(await page.title()).toBe(lockedTitle);
});
