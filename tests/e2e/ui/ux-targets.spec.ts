// UX-03 + UX-04 (ux-a11y-adversarial 2026-10-08): the two controls under the 44 px target on the guest pages. The
// landing's inline "Copy the address" keeps its look but its hit area is 44 px tall; the picker's month tabs are at
// least 44 px wide from 1024 px up (they are full-width segments below).
import { COPY_ADDRESS } from '../../../src/content/ui/landing';
import { DISHES } from '../../../src/content';
import { isBookable } from '../../../src/content/menu-helpers';
import { signInAs } from '../support/sessions';
import { expect, test } from '../support/fixtures';

const PICKER_DISH = DISHES.find((d) => d.flow === 'picker' && isBookable(d))?.slug;
const TAP = 44;

test('UX-03: "Copy the address" has a 44 px tall hit area, without changing its sentence', async ({
  page,
}) => {
  await page.goto('/');
  const copy = page.locator('#story').getByRole('button', { name: COPY_ADDRESS.label });
  await copy.scrollIntoViewIfNeeded();
  const rects = await copy.evaluate((e) => [...e.getClientRects()].map((r) => r.height));
  expect(Math.max(...rects)).toBeGreaterThanOrEqual(TAP);
  // the sentence's lines keep their spacing: the paragraph is as tall as it is without the target's padding
  const [withTarget, without] = await copy.evaluate((e) => {
    const p = e.closest('p')!;
    const h = p.getBoundingClientRect().height;
    (e as HTMLElement).style.setProperty('padding-block', '0');
    (e as HTMLElement).style.setProperty('margin-block', '0');
    const h0 = p.getBoundingClientRect().height;
    (e as HTMLElement).style.removeProperty('padding-block');
    (e as HTMLElement).style.removeProperty('margin-block');
    return [h, h0];
  });
  expect(Math.abs(withTarget - without)).toBeLessThanOrEqual(1);
});

test('UX-04: the month tabs are at least 44 px wide on a wide screen', async ({ page, baseURL }) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 1024,
    'from 1024 px up (below, the tabs are full-width segments)',
  );
  expect(PICKER_DISH, 'a bookable picker dish').toBeTruthy();
  await signInAs(page.context(), 'guest', baseURL!);
  await page.goto(`/book/${PICKER_DISH}`);
  const tabs = page.getByRole('tab');
  await expect(tabs.first()).toBeVisible();
  for (const tab of await tabs.all()) expect((await tab.boundingBox())!.width).toBeGreaterThanOrEqual(TAP);
});
