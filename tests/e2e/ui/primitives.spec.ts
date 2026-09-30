// tests/e2e/ui/primitives.spec.ts (U1): Sheet, Menu and Toast from src/ui under REAL input (keyboard + mouse), Chromium
// and WebKit, 375 + 1440, on the prototype-only /dev/axe page. Joins U7's config when T4.3.01 lands.
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { signCookie } from '../../../src/features/invites/tokens';

function devCookie(): string {
  const tag = createHash('sha256')
    .update(`twj-dev:${process.env.DEV_PASSPHRASE ?? ''}`)
    .digest('base64url')
    .slice(0, 16);
  return signCookie('dev', tag, 3600, process.env.SESSION_SIGNING_SECRET ?? '');
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'twj_dev', value: devCookie(), url: baseURL! }]);
});

async function open(page: Page) {
  await page.goto('/dev/axe');
  await expect(page.getByRole('status', { name: 'Bench' })).toHaveText('ready', { timeout: 20_000 });
}

async function tabTo(page: Page, name: string, max = 40) {
  const el = page.getByRole('button', { name, exact: true });
  for (let i = 0; i < max; i++) {
    if (await el.evaluate((n) => n === document.activeElement)) return el;
    await page.keyboard.press('Tab');
  }
  throw new Error(`never reached ${name} by Tab`);
}

test('Sheet: focus on the title, Tab stays inside, Esc closes back to the opener (R1-06)', async ({
  page,
}) => {
  await open(page);
  const opener = await tabTo(page, 'Open sheet');
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Sample sheet' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Sample sheet' })).toBeFocused();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await sheet.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await sheet.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
  // and it opens again after an Esc close
  await page.keyboard.press('Enter');
  await expect(sheet).toBeVisible();
});

test('Sheet: × and Cancel (data-close) close it; focus returns to the opener', async ({ page }) => {
  await open(page);
  const opener = page.getByRole('button', { name: 'Open sheet' });
  await opener.click();
  const sheet = page.getByRole('dialog', { name: 'Sample sheet' });
  await sheet.getByRole('button', { name: 'Close Sample sheet' }).click();
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});

test('Menu: Tab and Shift+Tab close it and move on from ⋯, never to the skip link (FOC-03)', async ({
  page,
}) => {
  await open(page);
  const more = await tabTo(page, 'More for Sample');
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Go somewhere' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Do something' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show toast' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(more).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Go somewhere' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(menu).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open sheet' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
});

test('Menu: opens fully on screen and a click outside closes it', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'More for Sample' }).click();
  const menu = page.getByRole('menu');
  const box = (await menu.boundingBox())!;
  const vh = await page.evaluate(() => window.innerHeight);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vh);
  await page.getByRole('heading', { name: 'Primitives' }).click();
  await expect(menu).toBeHidden();
});

test('Toast: a named region, focus on Undo in view, count runs, hover pauses (FOC-01/05)', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Show toast' }).click();
  const toast = page.getByRole('region', { name: /Locked in: Sample/ });
  await expect(toast).toBeVisible();
  const undo = toast.getByRole('button', { name: 'Undo lock-in for Sample' });
  await expect(undo).toBeFocused();
  const vh = await page.evaluate(() => window.innerHeight);
  const ub = (await undo.boundingBox())!;
  expect(ub.y + ub.height).toBeLessThanOrEqual(vh);
  await expect(toast).toContainText(/Invite goes out in [1-8] s\./, { timeout: 4000 });
  await toast.hover();
  await expect(toast).toContainText('Paused. The invite goes out 10 s after you leave Undo.');
  await page.mouse.move(5, 5);
  await expect(toast).toContainText('Invite goes out in 10 s.');
  await undo.click();
  await expect(toast).toBeHidden();
});
