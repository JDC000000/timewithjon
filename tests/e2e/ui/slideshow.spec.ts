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
  return 1 + (await fig.locator('.ph-slide.is-on').count());
}
/** photo 1 + the photos in the page so far (one ahead of the rotation) are there and loaded */
async function slidesLoaded(fig: Locator, n = 2) {
  await expect(fig.locator('img')).toHaveCount(n);
  await expect
    .poll(() => fig.locator('img').evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete)))
    .toBe(true);
}

test('photo 1 renders as a still photo; after load only photo 2 joins, in the same box; photo 3 is not fetched yet', async ({
  page,
}) => {
  const fetched: string[] = [];
  page.on('request', (r) => fetched.push(r.url()));
  await page.goto(BENCH, { waitUntil: 'domcontentloaded' });
  const fig = show(page);
  const first = fig.locator('img').first();
  await expect(first).toHaveAttribute('src', '/img/hero-480.webp');
  await expect(first).toHaveAttribute('loading', 'eager');
  const before = await fig.boundingBox();
  await slidesLoaded(fig);
  expect(await fig.boundingBox()).toEqual(before);
  for (const img of await fig.locator('.ph-slide img').all()) {
    await expect(img).toHaveAttribute('alt', '');
    await expect(img).toHaveAttribute('loading', 'lazy');
    // stacked over photo 1: centred in the figure's box and inside it (a framed slide is smaller; see the framing
    // tests; the centring translate may round a fraction of a pixel)
    const [b, f] = [(await img.boundingBox())!, (await fig.boundingBox())!];
    expect(b.x + b.width / 2).toBeCloseTo(f.x + f.width / 2, 0);
    expect(b.y + b.height / 2).toBeCloseTo(f.y + f.height / 2, 0);
    expect(b.width).toBeLessThanOrEqual(f.width + 0.5);
    expect(b.height).toBeLessThanOrEqual(f.height + 0.5);
  }
  // photo 3 waits until photo 2 is on top (UX-06: a visitor downloads only the photos the rotation reaches)
  await page.waitForTimeout(1500);
  expect(fetched.filter((u) => /\/img\/hero-3-/.test(u))).toEqual([]);
});

test('crossfades every 5 s; Pause holds the photo, Play resumes', async ({ page }) => {
  await page.clock.install();
  await page.goto(BENCH);
  const fig = show(page);
  await slidesLoaded(fig);
  expect(await onTop(fig)).toBe(1);
  await page.clock.runFor(SLIDE_MS);
  await expect.poll(() => onTop(fig)).toBe(2);
  await slidesLoaded(fig, 3); // photo 2 on top: photo 3 joins
  const second = fig.locator('.ph-slide').first();
  await expect.poll(() => second.evaluate((i) => Number(getComputedStyle(i).opacity))).toBe(1);

  // QA4 L8: the name is the word shown (Pause / Play), no aria-pressed (label in name, WCAG 2.5.3)
  await fig.getByRole('button', { name: 'Pause', exact: true }).click();
  const play = fig.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toHaveText('Play');
  await expect(play).not.toHaveAttribute('aria-pressed');
  await page.clock.runFor(SLIDE_MS * 3);
  expect(await onTop(fig)).toBe(2);
  await play.click();
  await expect(fig.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
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
  await expect(card(page).getByRole('button', { name: 'Play Sample card' })).toHaveText('Play');
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

test('framing: a framed slide on top shows paper in its margins, never the photos under it', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(BENCH);
  const fig = show(page);
  await slidesLoaded(fig);
  await page.clock.runFor(SLIDE_MS); // photo 2 on top: photo 3 (the narrow frame) joins
  await slidesLoaded(fig, 3);
  await fig.getByRole('button', { name: 'Pause', exact: true }).click();
  await fig.scrollIntoViewIfNeeded();
  const f = (await fig.boundingBox())!;
  // a strip at the figure's left edge: outside slide 3's narrow frame (0.6), inside photo 1 and slide 2
  const clip = { x: f.x + 2, y: f.y + f.height / 2 - 10, width: 12, height: 20 };
  const set = (state: 'slide3' | 'bare') =>
    fig.evaluate((el, s) => {
      el.querySelector<HTMLElement>(':scope > img')!.style.visibility = s === 'bare' ? 'hidden' : '';
      el.querySelectorAll<HTMLElement>('.ph-slide').forEach((sl) => {
        sl.style.transition = 'none';
        sl.classList.toggle('is-on', s === 'slide3');
        sl.style.visibility = s === 'bare' ? 'hidden' : '';
      });
      el.querySelector<HTMLElement>('.ph-play')!.style.visibility = 'hidden';
    }, state);
  await set('slide3');
  const withSlide = await page.screenshot({ clip });
  await set('bare');
  const paperOnly = await page.screenshot({ clip });
  expect(withSlide.equals(paperOnly), 'margin pixels = the bare paper').toBe(true);
});

// every photo on the guest pages is drawn: framing's size containment must never leave an image at 0 x 0
for (const path of ['/', '/menu'] as const)
  test(`framing: every photo on ${path} is drawn at its figure's size (no frame in a public build)`, async ({
    page,
  }) => {
    await page.goto(path);
    const rows = await page.locator('figure.ph > img').evaluateAll((imgs) =>
      imgs
        .filter((i) => i.closest('dialog') === null) // a closed sheet's photo has no box
        .map((i) => {
          const f = i.closest('figure')!.getBoundingClientRect();
          const r = i.getBoundingClientRect();
          const slot = (i.closest('figure') as HTMLElement).dataset.slot;
          return { slot, fw: f.width, fh: f.height, rw: r.width, rh: r.height };
        }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const { slot, fw, fh, rw, rh } of rows) {
      expect(rw, `${slot} width`).toBeCloseTo(fw, 0);
      expect(rh, `${slot} height`).toBeCloseTo(fh, 0);
    }
  });

// The closing photo (a .ph--close figure: its height comes from a token, not an aspect ratio) is drawn and decoded at
// every width: a size container must never resolve its height to 0 (the framing CSS once drew it at 0 x 0).
test("framing: the closing photo is decoded and drawn at its figure's size at 375/768/1024/1440", async ({
  page,
}) => {
  await page.addInitScript(() => {
    document.documentElement.style.scrollBehavior = 'auto';
  });
  await page.goto('/');
  const fig = page.locator('figure[data-slot="close"]');
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await fig.scrollIntoViewIfNeeded();
    const got = await fig.evaluate(async (f) => {
      const img = f.querySelector<HTMLImageElement>(':scope > img')!;
      await img.decode();
      const r = img.getBoundingClientRect();
      const b = f.getBoundingClientRect();
      return { natural: img.naturalWidth, w: r.width, h: r.height, fw: b.width, fh: b.height };
    });
    expect(got.natural, `${width}: decoded`).toBeGreaterThan(0);
    expect(got.fh, `${width}: figure height`).toBeGreaterThan(100);
    expect(got.w, `${width}: width`).toBeCloseTo(got.fw, 0);
    expect(got.h, `${width}: height`).toBeCloseTo(got.fh, 0);
  }
});
