// FOC-05 (VD8-02 + R8 INTERACT): toasts, pinned/sticky bars, the admin action bar and menus never overlap the
// focused control. A full Tab and Shift+Tab walk on every screen with a pinned element: 0 covered stops.
// Scope: phones + 768 × 200 % and 1.4.12 + 125 % text (sticky bars scroll-pad the page).
import { expect, test } from '../support/fixtures';
import { tabWalk } from '../support/focus-probe';
import { settle } from '../support/input';
import { inScope, PHONES } from '../support/scope';
import { fixmeUnlessLanded, gotoScreen, type ScreenKey } from '../support/screens';

const PINNED: ScreenKey[] = [
  'a2-requests',
  'a3-request-detail',
  'a3b-lock-undo',
  'a4-season',
  'a4c-away',
  's06-picker-open',
  's10-details-send',
];

// Only this case's part of the matrix (support/scope.ts); options only, so skipped runs start no browser page.
test.skip(
  ({ viewport, textMode }) =>
    !inScope(viewport, textMode, { viewports: [...PHONES, 'w768'], textModes: ['t200', 'sp125'] }),
  'FOC-05 runs on phones + 768 at 200 % and 1.4.12 + 125 %',
);

for (const key of PINNED) {
  test(`FOC-05 ${key}: nothing covers the focused control on a full Tab walk`, async ({ page }) => {
    fixmeUnlessLanded(test.fixme, [key]);
    await gotoScreen(page, key);
    await settle(page);
    const stops = [...(await tabWalk(page, 'Tab')), ...(await tabWalk(page, 'Shift+Tab', 90))];
    expect(stops.length, 'the walk reaches the page').toBeGreaterThan(3);
    const covered = stops.filter((stop) => stop.coveredBy !== null || stop.inView === 0);
    expect(covered, `covered stops: ${JSON.stringify(covered)}`).toEqual([]);
  });
}
