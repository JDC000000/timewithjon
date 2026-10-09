// M2 (Jon, 2026-10-09): on an iPhone a swipe moved the page behind The Long Distance's sheet, not the sheet, so its
// Book button was out of reach. While a dish sheet is open the page behind stays put, the sheet scrolls itself, and
// Book is on screen at once (pinned to the sheet's bottom edge). Every dish sheet, a short phone (iPhone with Safari's
// bars) and a desktop panel; then a tap on The Long Distance's Book opens its booking page.
import { expect, test, type Page } from '@playwright/test';
import { DISHES } from '../../../src/content';
import { isBookable } from '../../../src/content/menu-helpers';
import { signInAs } from '../support/sessions';

test.use({ hasTouch: true });

const SHEETS = DISHES.filter((d) => isBookable(d)).map((d) => d.slug);

async function openSheet(page: Page, slug: string) {
  await page.goto('/menu');
  const row = page.locator(`a.dish-row[href$="/${slug}"]`).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const sheet = page.locator('dialog.sheet[open]');
  await expect(sheet).toBeVisible();
  return sheet;
}

async function bookOnScreen(page: Page) {
  const book = page.locator('dialog.sheet[open] .sheet-in a[href^="/book/"]');
  await expect(book).toBeVisible();
  const [box, vh] = [await book.boundingBox(), page.viewportSize()!.height];
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
  return book;
}

test('every dish sheet: the page behind stays put, the sheet scrolls itself, Book is in reach', async ({
  page,
  baseURL,
}) => {
  const phone = (page.viewportSize()?.width ?? 0) < 600;
  if (phone) await page.setViewportSize({ width: 390, height: 664 }); // an iPhone with Safari's bars showing
  await signInAs(page.context(), 'guest', baseURL!);
  for (const slug of SHEETS) {
    const sheet = await openSheet(page, slug);
    await bookOnScreen(page);
    const y = await page.evaluate(() => scrollY);
    const box = (await sheet.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 60);
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => scrollY), `${slug}: the page behind moved`).toBe(y);
    await bookOnScreen(page);
    await page.keyboard.press('Escape');
  }
});

test('The Long Distance: a tap on Book opens its booking page', async ({ page, baseURL }) => {
  if ((page.viewportSize()?.width ?? 0) < 600) await page.setViewportSize({ width: 390, height: 664 });
  await signInAs(page.context(), 'guest', baseURL!);
  await openSheet(page, 'the-long-distance');
  await (await bookOnScreen(page)).tap();
  await expect(page).toHaveURL(/\/book\/the-long-distance$/);
});
