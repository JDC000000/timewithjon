// tests/e2e/ui/slideshow.spec.ts: the photo slideshow (src/ui/Slideshow.tsx) in real browsers, on the prototype-only
// bench /dev/slides (a fixture slot registry: public builds have no slideshow). The fixture's photos 2 and 3 are not
// on disk; this spec serves committed stand-ins for them, so no real photo is involved.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { signCookie } from '../../../src/features/invites/tokens';

const BENCH = '/dev/slides';
const SLIDE_MS = 5000;
/** fixture slide -> the committed stand-in served for it */
const STAND_IN: Record<string, string> = {
  'hero-2': 'why',
  'hero-3': 'close',
  'catch-release-2': 'grind',
  'catch-release-3': 'surprise-me',
};

function devCookie(): string {
  const tag = createHash('sha256')
    .update(`twj-dev:${process.env.DEV_PASSPHRASE ?? ''}`)
    .digest('base64url')
    .slice(0, 16);
  return signCookie('dev', tag, 3600, process.env.SESSION_SIGNING_SECRET ?? '');
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'twj_dev', value: devCookie(), url: baseURL! }]);
  await context.route(/\/img\/(hero|catch-release)-([23])-(\d+)\.webp$/, (route) => {
    const [, file, n, w] = /\/img\/(hero|catch-release)-([23])-(\d+)\.webp$/.exec(route.request().url())!;
    const body = readFileSync(join(process.cwd(), 'public', 'img', `${STAND_IN[`${file}-${n}`]}-${w}.webp`));
    return route.fulfill({ status: 200, contentType: 'image/webp', body });
  });
});

const show = (page: Page) => page.locator('figure[data-slot="show"]');
const card = (page: Page) => page.locator('li.dish');

async function onTop(fig: Locator): Promise<number> {
  return 1 + (await fig.locator('img.ph-slide.is-on').count());
}
async function slidesLoaded(fig: Locator) {
  await expect(fig.locator('img')).toHaveCount(3);
  await expect
    .poll(() => fig.locator('img').evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete)))
    .toBe(true);
}

test('photo 1 renders as a still photo; photos 2..n join after load in the same box', async ({ page }) => {
  await page.goto(BENCH, { waitUntil: 'domcontentloaded' });
  const fig = show(page);
  const first = fig.locator('img').first();
  await expect(first).toHaveAttribute('src', '/img/hero-480.webp');
  await expect(first).toHaveAttribute('loading', 'eager');
  const before = await fig.boundingBox();
  await slidesLoaded(fig);
  expect(await fig.boundingBox()).toEqual(before);
  for (const img of await fig.locator('img.ph-slide').all()) {
    await expect(img).toHaveAttribute('alt', '');
    await expect(img).toHaveAttribute('loading', 'lazy');
    // stacked over photo 1 in the figure's box (these slides are unframed, so they fill it; the centring
    // translate may round a fraction of a pixel)
    const [b, f] = [(await img.boundingBox())!, (await fig.boundingBox())!];
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(b[k], k).toBeCloseTo(f[k], 0);
  }
});

test('crossfades every 5 s; Pause holds the photo, Play resumes', async ({ page }) => {
  await page.clock.install();
  await page.goto(BENCH);
  const fig = show(page);
  await slidesLoaded(fig);
  expect(await onTop(fig)).toBe(1);
  await page.clock.runFor(SLIDE_MS);
  await expect.poll(() => onTop(fig)).toBe(2);
  const second = fig.locator('img.ph-slide').first();
  await expect.poll(() => second.evaluate((i) => Number(getComputedStyle(i).opacity))).toBe(1);

  // QA4 L8: one name ("Pause"); aria-pressed says it's paused; the word shown flips to Play
  const btn = fig.getByRole('button', { name: 'Pause', exact: true });
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveText('Play');
  await page.clock.runFor(SLIDE_MS * 3);
  expect(await onTop(fig)).toBe(2);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await page.clock.runFor(SLIDE_MS);
  await expect.poll(() => onTop(fig)).toBe(3);
  await page.clock.runFor(SLIDE_MS);
  await expect.poll(() => onTop(fig)).toBe(1);
});

test('the toggle: a 44 px target at the photo’s bottom-right, on a solid chip, with a visible focus ring', async ({
  page,
}) => {
  await page.goto(BENCH);
  // the site scrolls smoothly: measure only once a scroll has landed
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
  for (const [fig, btn] of [
    [show(page), show(page).getByRole('button', { name: 'Pause', exact: true })],
    [card(page).locator('figure'), card(page).getByRole('button', { name: 'Pause Sample card' })],
  ] as const) {
    await expect(btn).toBeVisible();
    await btn.scrollIntoViewIfNeeded();
    const [f, b] = await btn.evaluate(
      (e, figure) => {
        const box = (n: Element) => {
          const r = n.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        return [box(figure as Element), box(e)];
      },
      await fig.elementHandle(),
    );
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
    // inside the photo, in its bottom-right corner
    expect(b.x + b.width).toBeLessThanOrEqual(f.x + f.width);
    expect(b.y + b.height).toBeLessThanOrEqual(f.y + f.height);
    expect(f.x + f.width - (b.x + b.width)).toBeLessThan(20);
    expect(f.y + f.height - (b.y + b.height)).toBeLessThan(20);
    expect(await btn.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    // the topmost element at the button's centre is the button (not the photo's grain layer)
    expect(
      await btn.evaluate(async (e) => {
        // nothing focused (the focus helper keeps a focused control in view), no smooth scroll, then let it settle
        (document.activeElement as HTMLElement | null)?.blur();
        e.scrollIntoView({ block: 'center', behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return hit === e ? true : `${hit?.tagName}.${hit?.className} at ${r.x},${r.y}`;
      }),
    ).toBe(true);
    for (let i = 0; i < 20 && !(await btn.evaluate((e) => e === document.activeElement)); i++)
      await page.keyboard.press('Tab');
    await expect(btn).toBeFocused();
    expect(await btn.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe('none');
  }
});

test('a card’s toggle is outside its link (no nested control) and the bench is axe-clean', async ({
  page,
}) => {
  await page.goto(BENCH);
  await slidesLoaded(card(page).locator('figure'));
  const btn = card(page).getByRole('button', { name: 'Pause Sample card' }); // QA4 L8: names its card
  expect(await btn.evaluate((e) => e.closest('a'))).toBeNull();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveText('Play');
  expect(page.url()).toMatch(/\/dev\/slides$/); // the press did not follow the card's link
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
});

test('reduced motion: photo 1 only, no toggle, no rotation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto(BENCH);
  await page.waitForTimeout(1000); // hydrated, past the load event: still nothing added
  await page.clock.runFor(SLIDE_MS * 2);
  for (const fig of [show(page), card(page).locator('figure')])
    await expect(fig.locator('img')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^(Pause|Play)\b/ })).toHaveCount(0);
});

// docs/PHOTOS.md framing: a framed photo is drawn in the largest centred box of its frame ratio, per breakpoint; an
// unframed one still fills the whole box (cover). The fixture's views live in src/app/dev/slides.
test("framing: a framed photo's box is its frame ratio, centred, at 375/768/1024/1440; unframed fills the box", async ({
  page,
}) => {
  await page.goto(BENCH);
  await slidesLoaded(show(page));
  const boxes = () =>
    show(page).evaluate((fig) => {
      const r = (n: Element) => n.getBoundingClientRect();
      const f = r(fig);
      const [one, two] = [...fig.querySelectorAll('img')].map(r);
      return { f, one: one!, two: two! };
    });
  for (const [width, frame] of [
    [375, 1.2],
    [768, 1.2],
    [1024, 0.9],
    [1440, 0.9],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(
        async () => {
          const { one } = await boxes();
          return Math.round((one.width / one.height) * 100) / 100;
        },
        { message: `${width}px: photo 1 ratio` },
      )
      .toBeCloseTo(frame, 1);
    const { f, one, two } = await boxes();
    // inside the figure, centred
    expect(one.width).toBeLessThanOrEqual(f.width + 0.5);
    expect(one.height).toBeLessThanOrEqual(f.height + 0.5);
    expect(Math.abs(one.x + one.width / 2 - (f.x + f.width / 2))).toBeLessThan(1);
    expect(Math.abs(one.y + one.height / 2 - (f.y + f.height / 2))).toBeLessThan(1);
    // the largest such box: one side touches the figure
    expect(Math.min(Math.abs(one.width - f.width), Math.abs(one.height - f.height))).toBeLessThan(1);
    // slide 2 has no frame: it fills the figure, as before framing
    expect(Math.abs(two.width - f.width) + Math.abs(two.height - f.height)).toBeLessThan(1);
  }
});
