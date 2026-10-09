// The public /privacy page in real browsers: it opens signed out with no invite (a fresh context), shows Jon's words,
// and nothing scrolls sideways.
import { expect, test } from '@playwright/test';
import { PRIVACY } from '../../../src/content/ui/privacy';
import { horizontalOverflow } from '../support/layout';

test('/privacy opens with no invite and no session', async ({ page, context }) => {
  await context.clearCookies();
  const res = await page.goto('/privacy');
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(PRIVACY.pageTitle);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(PRIVACY.heading);
  await expect(page.getByText(PRIVACY.body)).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);
});
