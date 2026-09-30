// FOC-01 (VD9-01): after a real Lock in on A3 (and on a direct load / a reload of A3b), the undo toast is ≥ 50 % in
// view and focus is on its Undo button, inside the viewport, while the 10 s countdown runs; the countdown never
// ticks while the toast is under half in view. Scope: 320 / 375 (the case names 320/390) × every text mode.
import { expect, test } from '../support/fixtures';
import { elementState, focusState, toastState } from '../support/focus-probe';
import { lockIn, TOAST_UNDO } from '../support/flows';
import { settle, wheel, wheelTo } from '../support/input';
import { inScope, TALL_PHONES } from '../support/scope';
import { fixmeUnlessLanded, gotoScreen } from '../support/screens';

const COUNTDOWN = /goes out in (\d+) s/;

// Only this case's part of the matrix (support/scope.ts); options only, so skipped runs start no browser page.
test.skip(
  ({ viewport, textMode }) => !inScope(viewport, textMode, { viewports: TALL_PHONES }),
  'FOC-01 runs on 320 / 375',
);

for (const via of ['a real Lock in', 'a direct load', 'a reload'] as const) {
  test(`FOC-01 A3b after ${via}: the undo toast and its focused Undo stay in view; no tick off-screen`, async ({
    page,
  }) => {
    fixmeUnlessLanded(test.fixme, ['a3-request-detail', 'a3b-lock-undo']);
    if (via === 'a real Lock in') {
      await gotoScreen(page, 'a3-request-detail');
      await lockIn(page);
    } else {
      await gotoScreen(page, 'a3b-lock-undo');
      if (via === 'a reload') {
        await wheel(page, 5000);
        await page.reload();
      }
    }
    const undo = page.getByRole('button', TOAST_UNDO);
    await expect(undo).toBeVisible();
    await settle(page);

    const samples: { toast: number; undoInView: number; onUndo: boolean; seconds: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const [toast, undoBox, focus] = await Promise.all([
        toastState(page, undo, COUNTDOWN),
        elementState(undo),
        focusState(page),
      ]);
      samples.push({
        toast: toast.inView,
        undoInView: undoBox.inView,
        onUndo: !!focus && /^Undo/.test(focus.name),
        seconds: Number(COUNTDOWN.exec(toast.text)?.[1] ?? NaN),
      });
      await page.waitForTimeout(250);
    }
    const detail = JSON.stringify(samples);
    expect(samples[0]?.onUndo, `focus lands on Undo: ${detail}`).toBe(true);
    for (const [i, s] of samples.entries()) {
      expect(s.toast, `toast ≥ 50 % in view at sample ${i}: ${detail}`).toBeGreaterThanOrEqual(0.5);
      if (s.onUndo)
        expect(s.undoInView, `focused Undo in view at ${i}: ${detail}`).toBeGreaterThanOrEqual(0.99);
      const before = samples[i - 1];
      if (before && before.toast < 0.5 && s.toast < 0.5) {
        expect(s.seconds, `no tick while off-screen at ${i}: ${detail}`).toBe(before.seconds);
      }
    }
  });
}

// The countdown must hold while the toast is scrolled out of view (only where the toast sits in the page flow, e.g.
// at 200 % text; a pinned toast can't be scrolled away, so there is nothing to hold).
test('FOC-01 A3b: the countdown holds while the guest scrolls the toast out of view', async ({ page }) => {
  fixmeUnlessLanded(test.fixme, ['a3b-lock-undo']);
  await gotoScreen(page, 'a3b-lock-undo');
  const undo = page.getByRole('button', TOAST_UNDO);
  await expect(undo).toBeVisible();
  const seconds = async () =>
    Number(COUNTDOWN.exec((await toastState(page, undo, COUNTDOWN)).text)?.[1] ?? NaN);
  for (const delta of [-5000, 5000]) {
    await wheel(page, delta);
    if ((await toastState(page, undo, COUNTDOWN)).inView < 0.5) break;
  }
  const away = await toastState(page, undo, COUNTDOWN);
  if (away.inView >= 0.5) {
    test
      .info()
      .annotations.push({ type: 'note', description: 'the toast is pinned here: it cannot leave the view' });
    return;
  }
  const held = await seconds();
  await page.waitForTimeout(2500);
  expect(await seconds(), 'no tick while the toast is out of view').toBe(held);
  await wheelTo(page, undo);
  await page.mouse.move(1, 1); // hovering the toast pauses it (by design): the pointer rests elsewhere
  await expect
    .poll(seconds, { message: 'the count runs again once the toast is back', timeout: 6000 })
    .toBeLessThan(held);
});
