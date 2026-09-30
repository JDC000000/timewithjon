// FOC-04 (VD9-08 LANDFOCUS): after every navigation, Back, reload and submit (the sign-in steps, A3b, A4c, S11, the
// undone state), the focused element is a sensible one, fully in the viewport and uncovered. Scope: 320 / 375 /
// 768 / 1440 × every text mode.
import { expect, test } from '../support/fixtures';
import { focusState, isSeen } from '../support/focus-probe';
import { goBack, lockIn, sendRequest, TOAST_UNDO } from '../support/flows';
import { clickLikeAPerson, settle, wheel } from '../support/input';
import { inScope, WIDTHS } from '../support/scope';
import { fixmeUnlessLanded, gotoScreen, type ScreenKey } from '../support/screens';
import type { Page } from '@playwright/test';

const SCOPE = { viewports: WIDTHS };

/**
 * Focus has landed fully on screen and uncovered. `mayRest`: a fresh page may leave focus at the document start
 * (<body>, the pack's behaviour on load); an in-page change (the toast, the undone state) must move it to an element.
 */
async function expectLanded(page: Page, step: string, mayRest = false): Promise<void> {
  await settle(page);
  await page.waitForTimeout(150);
  await settle(page);
  const state = await focusState(page);
  if (mayRest && state === null) return;
  expect(state, `${step}: focus lands on an element`).not.toBeNull();
  expect(isSeen(state), `${step}: focus is fully on screen and uncovered: ${JSON.stringify(state)}`).toBe(
    true,
  );
}

// Pages that move focus on arrival or are reached by a submit: on load, and after the guest's own scroll + reload (twice).
const LANDING: ScreenKey[] = [
  'a1b-sign-in-code',
  'a1c-sign-in-confirm',
  'a3b-lock-undo',
  'a4c-away',
  's11-after-send',
];

// Only this case's part of the matrix (support/scope.ts); options only, so skipped runs start no browser page.
test.skip(
  ({ viewport, textMode }) => !inScope(viewport, textMode, SCOPE),
  'FOC-04 runs on 320 / 375 / 768 / 1440',
);

for (const key of LANDING) {
  test(`FOC-04 ${key}: focus lands in view on load and on each reload`, async ({ page }) => {
    fixmeUnlessLanded(test.fixme, [key]);
    await gotoScreen(page, key);
    await expectLanded(page, 'load', key !== 'a3b-lock-undo');
    for (const round of [1, 2]) {
      await wheel(page, 500);
      await page.reload();
      await expectLanded(page, `reload ${round}`, key !== 'a3b-lock-undo');
    }
  });
}

test('FOC-04 sign-in: after "Send me a code", focus lands in view on the code step', async ({ page }) => {
  fixmeUnlessLanded(test.fixme, ['a1-sign-in', 'a1b-sign-in-code']);
  await gotoScreen(page, 'a1-sign-in');
  await clickLikeAPerson(page, page.getByRole('button', { name: /^Send me a code/ }));
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(/^Sign in/);
  await expectLanded(page, 'code step', true);
});

test('FOC-04 S10 -> S11: after Send, and after Back to the form, focus is in view', async ({ page }) => {
  fixmeUnlessLanded(test.fixme, ['s10-details-send', 's11-after-send']);
  await gotoScreen(page, 's10-details-send');
  await sendRequest(page);
  await expectLanded(page, 'S11 after Send', true);
  await goBack(page);
  await expectLanded(page, 'S10 after Back', true);
});

test('FOC-04 A3 -> A3b -> Undo: focus lands in view on the toast, then on the undone state', async ({
  page,
}) => {
  fixmeUnlessLanded(test.fixme, ['a3-request-detail', 'a3b-lock-undo']);
  await gotoScreen(page, 'a3-request-detail');
  await lockIn(page);
  await expectLanded(page, 'A3b after Lock in');
  await page.waitForTimeout(650); // Undo ignores taps for 600 ms (the contract's double-tap guard)
  await clickLikeAPerson(page, page.getByRole('button', TOAST_UNDO));
  await expect(page.getByRole('button', TOAST_UNDO)).toBeHidden();
  await expectLanded(page, 'the undone state');
});
