// FOC-06 (R8 INTERACT): no focusable control sits off-screen when it receives focus: the A2 filter tabs (arrow keys
// along the strip) and every stop of a full Tab walk on the admin screens are fully in view, scrollers included.
// Scope: 320 / 375 / 768 / 1440 × every text mode.
import { expect, test } from '../support/fixtures';
import { focusState, isSeen, tabWalk, type FocusState } from '../support/focus-probe';
import { press, settle } from '../support/input';
import { inScope, WIDTHS } from '../support/scope';
import { fixmeUnlessLanded, gotoScreen, type ScreenKey } from '../support/screens';

const SCOPE = { viewports: WIDTHS };

/** Fully in view, or (a control taller than the viewport) filling most of it. */
function shown(state: FocusState | null, viewportHeight: number): boolean {
  if (!state) return false;
  if (state.bottom - state.top > viewportHeight) return state.inView >= 0.5 && state.coveredBy === null;
  return isSeen(state);
}

// Only this case's part of the matrix (support/scope.ts); options only, so skipped runs start no browser page.
test.skip(
  ({ viewport, textMode }) => !inScope(viewport, textMode, SCOPE),
  'FOC-06 runs on 320 / 375 / 768 / 1440',
);

test('FOC-06 A2: every filter tab is fully in view when the arrow keys reach it', async ({
  page,
  viewport,
}) => {
  fixmeUnlessLanded(test.fixme, ['a2-requests']);
  await gotoScreen(page, 'a2-requests');
  await settle(page);
  const tabs = page.getByRole('tab');
  const count = await tabs.count();
  expect(count, 'A2 has filter tabs').toBeGreaterThan(1);
  const onTab = () => page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab');
  for (let i = 0; i < 40 && !(await onTab()); i++) await press(page, 'Tab');
  expect(await onTab(), 'Tab reaches the filter tabs').toBe(true);
  const bad: FocusState[] = [];
  for (const key of ['ArrowRight', 'ArrowLeft'] as const) {
    for (let i = 0; i < count; i++) {
      await press(page, key);
      const state = await focusState(page);
      if (!shown(state, viewport?.height ?? 0) && state) bad.push(state);
    }
  }
  expect(bad, `tabs off-screen when focused: ${JSON.stringify(bad)}`).toEqual([]);
});

const ADMIN: ScreenKey[] = ['a2-requests', 'a3-request-detail', 'a4-season', 'a4c-away'];
for (const key of ADMIN) {
  test(`FOC-06 ${key}: every Tab stop is fully in view when it receives focus`, async ({
    page,
    viewport,
  }) => {
    fixmeUnlessLanded(test.fixme, [key]);
    await gotoScreen(page, key);
    await settle(page);
    const stops = await tabWalk(page, 'Tab');
    expect(stops.length, 'the walk reaches the page').toBeGreaterThan(3);
    const off = stops.filter((stop) => !shown(stop, viewport?.height ?? 0));
    expect(off, `stops not fully in view: ${JSON.stringify(off)}`).toEqual([]);
  });
}
