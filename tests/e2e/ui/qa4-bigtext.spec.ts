// QA4 L7 (proto walkthrough r4, 2026-10-08): at 200% text on a 320 or 375 phone, nothing scrolls sideways: the
// landing's stories@ address (one long word) breaks inside the column, and /admin/sign-in fits (WebKit 320 too).
// Sizes its own text and viewport (ui/** runs in the t100 projects only), so it runs in CI's smoke on both engines.
import { expect, test, type Page } from '@playwright/test';
import { horizontalOverflow } from '../support/layout';
import { ROUTES } from '../../../src/ui/routes';

async function at200(page: Page, width: number) {
  // one run per engine: the phone project (the desktop project would repeat the same case)
  test.skip((page.viewportSize()?.width ?? 0) > 500, 'phone project only');
  await page.setViewportSize({ width, height: 740 });
  await page.addInitScript(() => {
    // the user's text size, in place before the page's first layout (as ui/focus.spec.ts)
    const apply = () => document.documentElement?.style.setProperty('font-size', '200%', 'important');
    apply();
    document.addEventListener('DOMContentLoaded', apply);
  });
}

for (const width of [320, 375]) {
  test(`200% text at ${width}: the landing's stories@ address wraps; no sideways scroll`, async ({
    page,
  }) => {
    await at200(page, width);
    await page.goto('/');
    const address = page.locator('#story a[href^="mailto:"]');
    await expect(address).toBeVisible();
    const box = (await address.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test(`200% text at ${width}: admin sign-in has no sideways scroll`, async ({ page }) => {
    await at200(page, width);
    await page.goto(ROUTES.admin.signIn);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  });
}
