// Q9 (approved: Jon 2026-10-09) "How many of you?" in real browsers, on every booking flow: the stepper is there
// for a dish with a range (from 1 to the menu's servesMax) and absent for a fixed-size or one-person dish; its two
// buttons are 44 px targets, work from the keyboard, keep focus at the ends, and the area passes axe. Read-only:
// nothing is sent. Each case also saves a screenshot of the page and of the details for the PR
// (test-results/screens/crew-size/, uploaded by CI as the "ui-screens-<engine>" artifacts).
import type { Page } from '@playwright/test';
import { DISHES, FLOW } from '../../../src/content';
import { crewRange } from '../../../src/content/menu-helpers';
import { DETAILS } from '../../../src/content/ui/booking';
import { DETAILS_ID } from '../../../src/app/book/[dish]/_lib/form-errors';
import { expectAxeClean } from '../a11y/axe';
import { expect, test } from '../support/fixtures';
import { inScope } from '../support/scope';
import { TARGET } from '../support/screens';
import { GUEST_INVITE_FOR } from '../support/sessions';

test.skip(
  ({ viewport, textMode }) => TARGET !== 'app' || !inScope(viewport, textMode, { textModes: ['t100'] }),
  'the crew stepper runs on the app, at 100 % text',
);

/** One dish per booking flow, plus the fixed-size and one-person dishes that don't ask. */
const CASES: { name: string; slug: string; query?: string }[] = [
  { name: 'picker', slug: 'the-flat-white' },
  { name: 'old-haunt-weeknight', slug: 'the-old-haunt' },
  { name: 'old-haunt-weekend', slug: 'the-old-haunt', query: '?when=weekend' },
  { name: 'dates', slug: 'the-shore-ride' },
  { name: 'dates-fixed-size', slug: 'the-double-date' },
  { name: 'dates-one-person', slug: 'the-long-distance' },
  { name: 'pitch', slug: 'pitch-me' },
  { name: 'surprise', slug: 'surprise-me' },
];

async function shots(page: Page, name: string, testInfo: { project: { name: string } }) {
  const width = page.viewportSize()?.width ?? 0;
  const base = `test-results/screens/crew-size/${name}-${width}-${testInfo.project.name.replace(/[^\w-]+/g, '_')}`;
  await page.screenshot({ path: `${base}-page.png`, fullPage: true });
  // The details block (Pitch Me's form has no #details wrapper: its stepper's field stands in).
  const details = page.locator(`#${DETAILS_ID}`);
  const area = (await details.count()) ? details : page.locator('.field:has(.stepper)');
  await area.screenshot({ path: `${base}-details.png` });
}

for (const c of CASES) {
  const dish = DISHES.find((d) => d.slug === c.slug)!;
  const range = crewRange(dish);
  const asks = range.max > range.min;

  test(`Q9 ${c.name} (${c.slug}): ${asks ? `asks 1–${range.max}` : `doesn't ask (${range.min})`}`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/?for=${GUEST_INVITE_FOR}`);
    await page.goto(`/book/${c.slug}${c.query ?? ''}`);
    const group = page.getByRole('group', { name: FLOW.crewLabel });
    if (!asks) {
      await expect(page.locator(`#${DETAILS_ID}`)).toBeVisible();
      await expect(group).toHaveCount(0);
      await shots(page, c.name, testInfo);
      return;
    }
    await expect(group).toBeVisible();
    const fewer = group.getByRole('button', { name: DETAILS.crewFewer });
    const more = group.getByRole('button', { name: DETAILS.crewMore });
    const count = group.locator('output');
    await expect(count).toHaveText(String(range.min));
    for (const b of [fewer, more]) {
      const box = (await b.boundingBox())!;
      expect(box.width, 'target width').toBeGreaterThanOrEqual(44);
      expect(box.height, 'target height').toBeGreaterThanOrEqual(44);
    }
    await expect(fewer).toHaveAttribute('aria-disabled', 'true');

    // the keyboard: focus "One more", Enter and Space count up, and the end keeps focus
    await more.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expect(count).toHaveText(String(Math.min(range.max, range.min + 2)));
    for (let i = 0; i < range.max; i++) await page.keyboard.press('Enter');
    await expect(count).toHaveText(String(range.max));
    await expect(more).toHaveAttribute('aria-disabled', 'true');
    await expect(more).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(fewer).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(count).toHaveText(String(range.max - 1));

    await expectAxeClean(page);
    await shots(page, c.name, testInfo);
  });
}
