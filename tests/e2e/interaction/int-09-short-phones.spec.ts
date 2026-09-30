// INT-09 (VD10-01): on short phones (375×667, 320×568) the fixed undo toast never covers "Sending…" or any other
// status or control, at the top and after scrolling to the foot. Scope: the short phones × every text mode.
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { lockIn } from '../support/flows';
import { settle, wheel } from '../support/input';
import { coveredControls } from '../support/layout-probes';
import { inScope, SHORT_PHONES } from '../support/scope';
import { fixmeUnlessLanded, gotoScreen } from '../support/screens';

const ROLES = ['button', 'link', 'radio', 'checkbox', 'textbox', 'status'] as const;

async function covered(page: Page, step: string): Promise<string[]> {
  const out: string[] = [];
  for (const role of ROLES) out.push(...(await page.getByRole(role).evaluateAll(coveredControls)));
  out.push(...(await page.getByText('Sending…', { exact: true }).evaluateAll(coveredControls)));
  return out.map((line) => `${step}: ${line}`);
}

// Only this case's part of the matrix (support/scope.ts); options only, so skipped runs start no browser page.
test.skip(
  ({ viewport, textMode }) => !inScope(viewport, textMode, { viewports: SHORT_PHONES }),
  'INT-09 runs on 375×667 and 320×568',
);

for (const via of ['a real Lock in', 'a direct load'] as const) {
  test(`INT-09 A3b after ${via}: the toast covers no status or control on a short phone`, async ({
    page,
  }) => {
    fixmeUnlessLanded(test.fixme, ['a3-request-detail', 'a3b-lock-undo']);
    if (via === 'a real Lock in') {
      await gotoScreen(page, 'a3-request-detail');
      await lockIn(page);
    } else {
      await gotoScreen(page, 'a3b-lock-undo');
    }
    await settle(page);
    await expect(page.getByText('Sending…', { exact: true })).toBeVisible();
    const found = await covered(page, 'at landing');
    await wheel(page, 5000);
    found.push(...(await covered(page, 'at the foot')));
    expect(found).toEqual([]);
  });
}
