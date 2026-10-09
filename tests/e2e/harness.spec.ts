// Guards the harness itself (T4.3.09 run rules): the matrix is what the rules say, and each project's text size
// is in force before the page's own scripts run.
import { expect, test } from './support/fixtures';
import { elementsPastViewport, expectNoSideScroll, horizontalOverflow } from './support/layout';
import { PROFILES, profileFromEnv, projectSpecs } from './support/profiles';

const ROOT_FONT_PX = { t100: 16, t200: 32, sp125: 20 } as const;

// Runs in every profile (smoke included), in the two modes that change the size. The probe records the root font
// size when <body> is inserted (before any body content can paint) and at the first animation frame (first paint).
for (const mode of ['t200', 'sp125'] as const) {
  test.describe(`text mode ${mode}`, () => {
    test.use({ textMode: mode });

    test('the text size is in force before first paint', async ({ page }) => {
      await page.addInitScript(() => {
        const probe = window as unknown as { __rootFont?: Record<string, string> };
        const seen: Record<string, string> = {};
        probe.__rootFont = seen;
        const rec = (at: string) => {
          if (!(at in seen)) seen[at] = getComputedStyle(document.documentElement).fontSize;
        };
        const observer = new MutationObserver(() => {
          if (!document.body) return;
          rec('body');
          observer.disconnect();
        });
        observer.observe(document, { childList: true, subtree: true });
        requestAnimationFrame(() => rec('raf'));
      });
      await page.goto('/');
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __rootFont?: object }).__rootFont))
        .toEqual({ body: `${ROOT_FONT_PX[mode]}px`, raf: `${ROOT_FONT_PX[mode]}px` });
    });
  });
}

test('the run matrix follows the T4.3.09 run rules', async ({ browserName, viewport }) => {
  // Pure config: checked in the chromium 375x812 projects only (every profile has one; any --project filter keeps it).
  const checksHere = browserName === 'chromium' && viewport?.width === 375 && viewport.height === 812;
  test.skip(!checksHere, 'checked once per text mode');
  const smoke = projectSpecs(PROFILES.smoke).map((spec) => spec.name);
  expect(smoke).toEqual([
    'chromium-375x812-t100',
    'chromium-1440x900-t100',
    'webkit-375x812-t100',
    'webkit-1440x900-t100',
  ]);
  expect(PROFILES.smoke.runs).toBe(1);

  const full = projectSpecs(PROFILES.full);
  expect(full).toHaveLength(2 * 6 * 3);
  expect(new Set(full.map((spec) => spec.name)).size).toBe(full.length);
  expect(new Set(full.map((spec) => `${spec.viewport.width}x${spec.viewport.height}`))).toEqual(
    new Set(['320x740', '375x812', '768x1024', '1440x900', '375x667', '320x568']),
  );
  expect(new Set(full.map((spec) => spec.textMode))).toEqual(new Set(['t100', 't200', 'sp125']));
  expect(new Set(full.map((spec) => spec.engine))).toEqual(new Set(['chromium', 'webkit']));
  expect(PROFILES.full.runs).toBe(5);

  expect(profileFromEnv(undefined)).toBe(PROFILES.smoke);
  expect(profileFromEnv('')).toBe(PROFILES.smoke);
  expect(profileFromEnv('full')).toBe(PROFILES.full);
  expect(() => profileFromEnv('fulll')).toThrow(/E2E_PROFILE/);
});

// The probes must be able to fail, or a green run proves nothing. A fixture page (not the app) is fine here.
test.describe('probes', () => {
  test.use({ allowPageErrors: true });
  test('the overflow and error probes catch a bad page', async ({ page, pageErrors }) => {
    await page.setContent(
      '<div style="width:3000px">wide</div>' +
        '<script>console.error("probe: console"); setTimeout(() => { throw new Error("probe: thrown"); });</script>',
    );
    expect(await horizontalOverflow(page)).toBeGreaterThan(0);
    await expect.poll(() => pageErrors.length).toBe(2);
    expect(pageErrors).toEqual(expect.arrayContaining(['probe: console', 'probe: thrown']));
  });
  test('the settled sideways-scroll check fails on a page that stays too wide, and names the element', async ({
    page,
  }) => {
    await page.setContent('<p>fits</p><div class="too-wide" style="width:3000px">wide</div>');
    expect(await elementsPastViewport(page)).toEqual([
      expect.stringMatching(/^div\.too-wide right=3\d{3} "wide"$/),
    ]);
    await expect(expectNoSideScroll(page, 'a fixture page')).rejects.toThrow(/sideways scroll/);
    await page.setContent('<p>fits</p>');
    await expectNoSideScroll(page, 'a fixture page that fits');
  });
});

// F4 guard: a console error the test did not opt into fails the test (the automatic pageErrors fixture checks at
// the end). Expected to fail: if the fixture stops checking, this test "unexpectedly passes" and goes red.
test('an unexpected console error fails the test', async ({ page }) => {
  test.fail();
  await page.setContent('<script>console.error("probe: stray")</script>');
  await expect(page.locator('body')).toBeAttached();
});
