// Design round 6 (M1 A): every bookable card on /menu ends in a button-look label, "Book {dish}" (the sheet's own
// words), 48 px, in the site's .btn style with its arrow, on every bookable card whatever the gate (the sheet then
// shows Book or the gate line). It is part of the card's one link: no nested control, the
// whole card is the target and keeps its own focus ring; pressing the label opens the dish sheet. On a 3-column
// desktop row the labels line up at the cards' foot. Role / accessible-name selectors.
import { expect, test } from '../support/fixtures';
import { GUEST_INVITE_FOR } from '../support/sessions';

async function openMenu(page: import('@playwright/test').Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`/?for=${GUEST_INVITE_FOR}`);
  await page.goto('/menu');
  await page.waitForLoadState('networkidle'); // hydrated: the cards open their sheets
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const)
  test(`${width}: every card ends in its 48 px "Book {dish}" label, inside the card's link`, async ({
    page,
  }) => {
    await openMenu(page, width, height);
    const cards = page.locator('li.dish > a.dish-row');
    await expect(cards).toHaveCount(15);
    for (const card of await cards.all()) {
      const label = card.locator('.dish-book');
      await expect(label).toBeVisible();
      await expect(label).toHaveText(/^Book .+ →$/);
      const [c, l] = [(await card.boundingBox())!, (await label.boundingBox())!];
      expect(l.height).toBeGreaterThanOrEqual(48);
      // inside the card, at its foot
      expect(l.y + l.height).toBeLessThanOrEqual(c.y + c.height + 0.5);
      expect(c.y + c.height - (l.y + l.height)).toBeLessThan(20);
      expect(await card.locator('a, button, [tabindex]').count()).toBe(0);
    }
    if (width === 1440) {
      // a row of three cards: the labels' bottoms line up
      const bottoms = await page
        .locator('section.course')
        .first()
        .locator('.dish-book')
        .evaluateAll((ls) => ls.slice(0, 3).map((l) => Math.round(l.getBoundingClientRect().bottom)));
      expect(new Set(bottoms).size, `${bottoms}`).toBe(1);
    }
  });

test('pressing the label opens the sheet; closing it hands focus back to the whole card, with its ring', async ({
  page,
}) => {
  await openMenu(page, 390, 844);
  const card = page.getByRole('link', { name: /^The Flat White.*Book The Flat White$/ });
  await card.locator('.dish-book').click();
  const sheet = page.getByRole('dialog', { name: 'The Flat White' });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  // Esc (a key press) hands focus back to the card: the whole card is the focus target, with its ring
  await expect(card).toBeFocused();
  expect(await card.evaluate((a) => getComputedStyle(a).outlineStyle)).not.toBe('none');
});
