// INT-01 (VD8-01): with 0 / 1 / the most picks, the month tabs never push the picker sideways and the page never
// scrolls sideways. Every width × text mode, both engines.
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { clickLikeAPerson } from '../support/input';
import { horizontalOverflow } from '../support/layout';
import { fixmeUnlessLanded, gotoScreen } from '../support/screens';

async function layout(page: Page) {
  const panel = await page.getByRole('tabpanel').boundingBox();
  return { panelLeft: Math.round(panel?.x ?? NaN), overflow: await horizontalOverflow(page) };
}

test('INT-01 S6: 0, 1 and the most picks keep the picker in place, no sideways scroll', async ({ page }) => {
  fixmeUnlessLanded(test.fixme, ['s06-picker-open']);
  await gotoScreen(page, 's06-picker-open');
  const panel = page.getByRole('tabpanel');
  const start = await layout(page);
  const seen: { picks: number; panelLeft: number; overflow: number }[] = [];
  const record = async () =>
    seen.push({ picks: await panel.getByRole('button', { pressed: true }).count(), ...(await layout(page)) });

  // 0 picks: un-pick every picked time.
  for (let i = 0; i < 10 && (await panel.getByRole('button', { pressed: true }).count()); i++) {
    await clickLikeAPerson(page, panel.getByRole('button', { pressed: true }).first());
  }
  await record();
  // 1, 2, … picks until the picker takes no more (or every time is picked).
  for (let i = 0; i < 8; i++) {
    const open = panel.getByRole('button', { pressed: false, disabled: false });
    if (!(await open.count())) break;
    const before = await panel.getByRole('button', { pressed: true }).count();
    await clickLikeAPerson(page, open.first());
    await record();
    if ((await panel.getByRole('button', { pressed: true }).count()) === before) break; // the most picks reached
  }
  const detail = JSON.stringify({ start, seen });
  expect(seen.some((s) => s.picks === 0) && seen.some((s) => s.picks === 1), detail).toBe(true);
  for (const s of seen) {
    expect(s.overflow, `no sideways scroll: ${detail}`).toBe(0);
    expect(
      Math.abs(s.panelLeft - start.panelLeft),
      `the picker stays in place: ${detail}`,
    ).toBeLessThanOrEqual(1);
  }
});
