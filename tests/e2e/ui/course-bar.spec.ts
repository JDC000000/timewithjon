// S04b the sticky course bar on /menu (T1.3.U3, R1-16), real browsers: no sideways scroll at 320 px, every course
// link >= 44 px, the bar stays pinned, and a keyboard jump (Tab to the link, Enter) lands focus on the course heading
// below the bar. Role/label selectors only.
import { MENU_LABELS } from '../../../src/content';
import { ROUTES } from '../../../src/ui/routes';
import { expect, test } from '../support/fixtures';
import { horizontalOverflow } from '../support/layout';

const COURSES = ['Starters', 'Mains', 'Big Days', 'Off the Menu'];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  expect((await page.goto(ROUTES.menu))?.status()).toBe(200);
  await page.waitForLoadState('networkidle'); // hydrated: CourseBar's listeners are on
});

test('the course bar fits 320 px with 44 px targets and one link per course', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: MENU_LABELS.courses });
  await expect(nav).toHaveCount(1);
  const links = nav.getByRole('link');
  await expect(links).toHaveText(COURSES);
  expect(await horizontalOverflow(page)).toBe(0);
  for (const link of await links.all()) {
    const box = (await link.boundingBox())!;
    expect(box.height, `${await link.textContent()} height`).toBeGreaterThanOrEqual(44);
    expect(box.width, `${await link.textContent()} width`).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  await expect(nav.getByRole('link', { name: 'Starters' })).toHaveAttribute('aria-current', 'true');
});

test('Tab reaches each course link; Enter moves focus to that heading below the pinned bar', async ({
  page,
}) => {
  const nav = page.getByRole('navigation', { name: MENU_LABELS.courses });
  const first = nav.getByRole('link', { name: COURSES[0] });
  for (let i = 0; i < 40 && !(await first.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  for (const name of COURSES.slice(1)) {
    await page.keyboard.press('Tab');
    await expect(nav.getByRole('link', { name })).toBeFocused();
  }
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab'); // back to Mains
  await expect(nav.getByRole('link', { name: 'Mains' })).toBeFocused();
  await page.keyboard.press('Enter');
  const heading = page.getByRole('heading', { level: 2, name: 'Mains' });
  await expect(heading).toBeFocused();
  await expect(nav.getByRole('link', { name: 'Mains' })).toHaveAttribute('aria-current', 'true');
  const bar = (await nav.boundingBox())!;
  const h = (await heading.boundingBox())!;
  expect(bar.y, 'the bar is pinned to the top').toBeLessThanOrEqual(1);
  expect(h.y, 'the heading is not under the bar').toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(h.y + h.height).toBeLessThanOrEqual(640);
  expect(await horizontalOverflow(page)).toBe(0);
});
