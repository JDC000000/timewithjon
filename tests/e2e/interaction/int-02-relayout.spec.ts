// INT-02 (VD8-03): after any text change after load (the picked count in a month tab, the crew count), the rows
// re-lay out cleanly: no stray separator dots, no row mixing stacked and one-line tiles (WebKit included).
// Every width × text mode.
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { clickLikeAPerson } from '../support/input';
import { rowProblems } from '../support/layout-probes';
import { fixmeUnlessLanded, gotoScreen, TARGET } from '../support/screens';

async function problems(page: Page, step: string): Promise<string[]> {
  // Guard: a drifted locator (role rename, an empty panel) must fail here, never pass by measuring nothing.
  const tileLoc = page.getByRole('tabpanel').getByRole('button');
  const tabLoc = page.getByRole('tab');
  expect(await tileLoc.count(), `${step}: tiles to measure`).toBeGreaterThan(3);
  expect(await tabLoc.count(), `${step}: month tabs`).toBeGreaterThan(1);
  const tiles = await tileLoc.evaluateAll(rowProblems, 'lines' as const);
  const tabs = await tabLoc.evaluateAll(rowProblems, 'firstLine' as const);
  return [...tiles, ...tabs].map((p) => `${step}: ${p}`);
}

test('INT-02 S6: picks change the text; rows stay clean', async ({ page }) => {
  fixmeUnlessLanded(test.fixme, ['s06-picker-open']);
  await gotoScreen(page, 's06-picker-open');
  const panel = page.getByRole('tabpanel');
  // Measured after real input only: at `load` the page may not be hydrated yet (the first paint has its own case).
  const found: string[] = [];
  await clickLikeAPerson(page, panel.getByRole('button', { pressed: false, disabled: false }).first());
  found.push(...(await problems(page, 'after a pick')));
  await clickLikeAPerson(page, panel.getByRole('button', { pressed: true }).first());
  found.push(...(await problems(page, 'after an un-pick')));
  expect(found).toEqual([]);
});

test('INT-02 S6: the crew count changes the text; rows stay clean', async ({ page }) => {
  fixmeUnlessLanded(test.fixme, ['s06-picker-open']);
  test.fixme(TARGET === 'app', 'the S6 crew stepper ("Who’s coming?") is not on main yet (owner lane U3)');
  await gotoScreen(page, 's06-picker-open');
  const more = page.getByRole('button', { name: 'One more' });
  for (let i = 0; i < 2; i++) await clickLikeAPerson(page, more);
  expect(await problems(page, 'after the crew count changed')).toEqual([]);
});

// The first paint: the server HTML, before any script runs (JavaScript off shows exactly what a slow phone paints
// until hydration). A row must not mix stacked and one-line tiles here either.
test.describe('first paint', () => {
  test.use({ javaScriptEnabled: false });
  test('INT-02 S6: the first paint (before hydration) already has clean rows', async ({ page }) => {
    fixmeUnlessLanded(test.fixme, ['s06-picker-open']);
    // TODO(U3): useTileStack (src/app/book/[dish]/_lib/useFit.ts) sets data-stack only after hydration, so the
    // server HTML paints mixed rows at 375 px (Thu · noon–2 pm wraps, Fri does not; seen with JavaScript off in
    // Chromium and WebKit) and jumps on hydration. Unfixme when U3 renders a stable first paint.
    test.fixme(
      TARGET === 'app',
      'first paint mixes stacked and one-line tiles before hydration (owner lane U3)',
    );
    await gotoScreen(page, 's06-picker-open');
    expect(await problems(page, 'first paint')).toEqual([]);
  });
});
