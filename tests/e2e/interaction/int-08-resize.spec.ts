// INT-08 (VD10-03): resizing or rotating the viewport (and the phone keyboard opening) never jumps the page to the
// focused field unless focus came from the keyboard and the field is fully hidden. Pointer focus here, so: no jump.
// Scope: 320 / 375 at 100 %.
import { expect, test } from '../support/fixtures';
import { elementState } from '../support/focus-probe';
import { clickLikeAPerson, scrollStill, wheel } from '../support/input';
import { inScope, TALL_PHONES } from '../support/scope';
import { fixmeUnlessLanded, gotoScreen } from '../support/screens';

const SCOPE = { viewports: TALL_PHONES, textModes: ['t100'] } as const;

// Only this case's part of the matrix (support/scope.ts); options only, so skipped runs start no browser page.
test.skip(
  ({ viewport, textMode }) => !inScope(viewport, textMode, SCOPE),
  'INT-08 runs on 320 / 375 at 100 %',
);

test('INT-08 S10: the phone keyboard opening does not jump the page to a tapped field', async ({
  page,
  viewport,
}) => {
  fixmeUnlessLanded(test.fixme, ['s10-details-send']);
  if (!viewport) return;
  await gotoScreen(page, 's10-details-send');
  // T1.7.U2: the personal invite's details sit behind "Sending as … · Change".
  const change = page.getByRole('button', { name: 'Change', exact: true });
  if (await change.count()) await clickLikeAPerson(page, change);
  const field = page.getByRole('textbox', { name: /^Your name/ });
  await clickLikeAPerson(page, field);
  // The field near the bottom edge, so a shorter viewport hides it.
  const box = await field.boundingBox();
  await wheel(page, (box?.y ?? 0) + (box?.height ?? 0) - viewport.height + 8);
  const before = await page.evaluate(() => scrollY);
  await page.setViewportSize({ width: viewport.width, height: Math.round(viewport.height * 0.55) });
  await page.waitForTimeout(400);
  await scrollStill(page);
  expect(await page.evaluate(() => scrollY), 'the page stays where the guest left it').toBe(before);
});

test('INT-08 S10: rotating the phone does not jump the page to a tapped field scrolled away', async ({
  page,
  viewport,
  browserName,
}) => {
  fixmeUnlessLanded(test.fixme, ['s10-details-send']);
  // Follow-up FU-WK-ROTATE (Jon, 2026-10-03): WebKit scrolls the focused field into view on its own when the
  // viewport rotates, so this check fails on WebKit at 375 wide (3 of 3 CI runs). Chromium still enforces it.
  test.skip(browserName === 'webkit', 'FU-WK-ROTATE: WebKit scrolls to the focused field on rotate by itself');
  if (!viewport) return;
  await gotoScreen(page, 's10-details-send');
  // T1.7.U2: the personal invite's details sit behind "Sending as … · Change".
  const change = page.getByRole('button', { name: 'Change', exact: true });
  if (await change.count()) await clickLikeAPerson(page, change);
  const field = page.getByRole('textbox', { name: /^Your name/ });
  await clickLikeAPerson(page, field);
  await wheel(page, -5000); // the guest scrolls back up to the times; focus stays in the field
  expect((await elementState(field)).inView, 'the field is scrolled away').toBe(0);
  const before = await page.evaluate(() => scrollY);
  await page.setViewportSize({ width: viewport.height, height: viewport.width });
  await page.waitForTimeout(400);
  await scrollStill(page);
  // Landscape reflow may bring the field up by itself; a jump shows as the page scrolling from where it was.
  expect(await page.evaluate(() => scrollY), 'the page did not jump to the field').toBe(before);
});
