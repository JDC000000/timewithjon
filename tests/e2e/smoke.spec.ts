// T4.3.01 smoke: the prototype build boots and serves clean, private, non-overflowing pages with real content, in
// both engines. Console/page errors fail every test (support/fixtures.ts). The journey (T4.3.02) and the keyboard +
// focus suite (T4.3.09) build on the same fixtures.
import { DISHES, ERRORS, MENU_LABELS, MENU_TITLE } from '../../src/content';
import { isBookable } from '../../src/content/menu-helpers';
import { pickerHeading } from '../../src/app/book/[dish]/_lib/flow-view';
import { TAG_UI } from '../../src/content/ui/tag';
import { PHOTO_DIR, PHOTO_SLOTS } from '../../src/ui/photo-slots';
import { ROUTES } from '../../src/ui/routes';
import { expect, test } from './support/fixtures';
import { horizontalOverflow } from './support/layout';

test('the landing page loads clean, private and without sideways scroll', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
  await expect(page).toHaveTitle('Time with Jon');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await page.waitForLoadState('networkidle');
  expect(await horizontalOverflow(page)).toBe(0);
});

// The landing (T1.2, pack v2.2 s01): one h1 (the open line + How about now?) and the hero photo in its slot.
test('the landing page shows its heading and its hero photo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('How about now?');
  const hero = page.locator('figure[data-slot="hero"] img');
  await expect(hero).toHaveAttribute('fetchpriority', 'high');
  // …and preloaded from the head (react-dom preload), so the browser fetches it before layout
  await expect(page.locator('head link[rel="preload"][as="image"][fetchpriority="high"]')).toHaveCount(1);
  await expect
    .poll(() => hero.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
});

// A page with real content on main today: a picker dish opened without an invite shows its heading and the
// no-invite line (wireframe 04-C). A page that renders nothing fails here.
test('a booking page renders its heading and line without an invite', async ({ page }) => {
  const dish = DISHES.find((d) => d.flow === 'picker' && isBookable(d));
  expect(dish, 'a bookable picker dish in src/content').toBeDefined();
  const response = await page.goto(`/book/${dish!.slug}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
  await expect(page.getByRole('heading', { level: 1, name: pickerHeading() })).toBeVisible();
  await expect(page.getByRole('main').getByRole('note')).toHaveText(ERRORS.noInvite);
  await page.waitForLoadState('networkidle');
  expect(await horizontalOverflow(page)).toBe(0);
});

// S12b the wine tag (U2 PR3, pack v2.2): served, private, one Letter sheet of four tags that fits the column, and its
// ‹ Sent back link returns to S11. Reached only from the no-gifts P.S.: the landing links nowhere near it (NOGIFTSPS).
test('the wine tag page serves its sheet and its back link returns to Sent', async ({ page }) => {
  const response = await page.goto(ROUTES.tag);
  expect(response?.status()).toBe(200);
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
  await expect(page).toHaveTitle('Wine tag · Time with Jon');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TAG_UI.title);
  await expect(page.getByRole('img', { name: TAG_UI.sheetLabel })).toBeVisible();
  await expect(page.getByRole('button', { name: TAG_UI.print })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await horizontalOverflow(page)).toBe(0);
  await page.getByRole('link', { name: TAG_UI.back }).click();
  await expect(page).toHaveURL(ROUTES.sent);
  await page.goto('/');
  await expect(page.locator(`a[href="${ROUTES.tag}"]`)).toHaveCount(0);
});

// S04 + S05 (PR #92 review F1): the menu page, and a dish sheet opened from the keyboard and from a deep link. Real
// browsers only: native <dialog> focus return can't be proved in jsdom (WebKit doesn't focus a link on mouse click).
test('the menu page opens a dish sheet by keyboard and by deep link, and Esc returns focus to the row', async ({
  page,
}) => {
  const name = 'The Long Lunch';
  const response = await page.goto(ROUTES.menu);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(MENU_TITLE);
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(4);
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(15); // the Bluebird is off the menu (2026-10-05)
  await page.waitForLoadState('networkidle');
  const row = page.locator('a[aria-haspopup="dialog"]', { hasText: name });
  await expect(row).toHaveAttribute('aria-haspopup', 'dialog');
  await row.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name })).toBeFocused();
  await expect(sheet.getByRole('button', { name: MENU_LABELS.close(name) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(row).toBeFocused();
  await page.goto('about:blank'); // a real load: the deep link is read on load (a same-page hash change is not)
  await page.goto(`${ROUTES.menu}#the-long-lunch`);
  await expect(page.getByRole('dialog', { name })).toBeVisible();
});

// The server reaches its database: every later journey depends on it. (A fresh DB has no cron tick or media
// run yet, so /api/health is 503 overall here; only the database check is asserted.)
test('the prototype server reaches its database', async ({ request }) => {
  const response = await request.get('/api/health');
  const report = (await response.json()) as { checks: Record<string, string> };
  expect(report.checks.database).toBe('ok');
});

// Jon decision 48: his real photos replaced the stand-ins in public/img. Every photo on /, /menu and /sent loads
// (lazy ones forced eager, so they fetch too), no /img request fails, and every file a Jon's-own slot lists is
// served as webp. Console 404s fail the test through the fixture.
test('the photos on /, /menu and /sent all load, and every Jon’s-own photo file is served (dec 48)', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  for (const path of ['/', ROUTES.menu, ROUTES.sent]) {
    const failed: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/img/') && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await page.waitForLoadState('networkidle');
    // lazy ones (below the fold, or in a closed dish sheet) are made eager so every photo is fetched
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [...document.querySelectorAll<HTMLImageElement>('img[src^="/img/"]')]
              .map((img) => {
                img.loading = 'eager';
                return img.complete && img.naturalWidth > 0 ? '' : img.currentSrc || img.src;
              })
              .filter(Boolean),
          ),
        { message: path, timeout: 15_000 },
      )
      .toEqual([]);
    expect(failed, path).toEqual([]);
    page.removeAllListeners('response');
  }
  const own = Object.values(PHOTO_SLOTS).filter((p) => !p.credit);
  expect(own.length).toBeGreaterThan(0);
  for (const p of own)
    for (const w of p.w) {
      const r = await request.get(`${PHOTO_DIR}/${p.file}-${w}.webp`);
      expect(r.status(), `${p.file}-${w}`).toBe(200);
      expect(r.headers()['content-type'], `${p.file}-${w}`).toContain('image/webp');
    }
});
