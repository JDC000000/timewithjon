// tests/e2e/ui/focus.spec.ts (U1, decision 29): src/ui/focus.ts under REAL input (page.keyboard / page.mouse; never
// element.focus() or injected state), in Chromium AND WebKit, at 375 and 1440, text size set before load.
// Drives the prototype-only bench /dev/axe/focus (a prototype server; DEV_PASSPHRASE + SESSION_SIGNING_SECRET in
// the env, as scripts/ci-placeholder-env.sh sets them). Joins U7's Playwright config (T4.3.01) when it lands.
import { createHash } from 'node:crypto';
import { expect, test, type ElementHandle, type Locator, type Page } from '@playwright/test';
import { signCookie } from '../../../src/features/invites/tokens';

const BENCH = '/dev/axe/focus';

/** The twj_dev cookie, minted like src/features/dev/guard.ts (the /dev/login form needs a database). */
function devCookie(): string {
  const pass = process.env.DEV_PASSPHRASE ?? '';
  const tag = createHash('sha256').update(`twj-dev:${pass}`).digest('base64url').slice(0, 16);
  return signCookie('dev', tag, 3600, process.env.SESSION_SIGNING_SECRET ?? '');
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'twj_dev', value: devCookie(), url: baseURL! }]);
});

async function open(page: Page, textScale = 1, query = '') {
  if (textScale !== 1) {
    await page.addInitScript((pct) => {
      // the user's text size, in place before the page's first layout and before any page script runs
      const apply = () => document.documentElement?.style.setProperty('font-size', `${pct}%`, 'important');
      apply();
      document.addEventListener('DOMContentLoaded', apply);
    }, textScale * 100);
  }
  await page.goto(BENCH + query);
  await expect(page.getByRole('status', { name: 'Bench' })).toHaveText('ready', { timeout: 20_000 });
}

/** The element's box is fully inside the viewport, and not under the pinned bar. */
async function fullyVisible(page: Page, el: Locator) {
  const [box, vh, barTop] = await Promise.all([
    el.boundingBox(),
    page.evaluate(() => window.innerHeight),
    page.getByRole('region', { name: 'Pinned bar' }).evaluate((b) => b.getBoundingClientRect().top),
  ]);
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(Math.min(vh, barTop));
}

/** Polls (up to 1 s: the settle re-keep runs a frame + 120 ms after focus) until el is fully in view, clear of the bar. */
async function fullyVisibleHandle(page: Page, el: ElementHandle) {
  const barTop = await page
    .getByRole('region', { name: 'Pinned bar' })
    .evaluate((b) => b.getBoundingClientRect().top);
  await expect
    .poll(
      async () => {
        const box = await el.boundingBox();
        if (!box) return 'ok'; // not rendered
        const vh = await page.evaluate(() => window.innerHeight);
        const name = await el.evaluate((n) => n.textContent?.trim().slice(0, 30));
        return box.y >= 0 && box.y + box.height <= Math.min(vh, barTop)
          ? 'ok'
          : `${name}: ${box.y}..${box.y + box.height}`;
      },
      { timeout: 1000 },
    )
    .toBe('ok');
}

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

/** Waits until a wheel scroll has come to rest (WebKit animates it). */
async function settledScrollY(page: Page): Promise<number> {
  // let focus.ts's own timers (a frame + 120 ms settle) run out first, then wait for three equal reads 150 ms apart:
  // WebKit animates a wheel scroll and can pause mid-glide under load (pr72-review F2b)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 200))));
  let last = -1;
  let same = 0;
  for (let i = 0; i < 30; i++) {
    const y = await scrollY(page);
    same = y === last ? same + 1 : 0;
    if (same >= 2) return y;
    last = y;
    await page.waitForTimeout(150);
  }
  return last;
}

async function tabTo(page: Page, el: Locator, max = 40) {
  for (let i = 0; i < max; i++) {
    if (await el.evaluate((n) => n === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('never reached by Tab');
}

test('moveFocus from a click lands on a far control, fully in view (FOC-04)', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Move focus far' }).click();
  const far = page.getByRole('button', { name: 'Far target' });
  await expect(far).toBeFocused();
  await fullyVisible(page, far);
});

test('a control under the pinned bar is lifted above it (FOC-05)', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Move focus under the bar' }).click();
  const target = page.getByRole('button', { name: 'Covered target', exact: true });
  await expect(target).toBeFocused();
  await fullyVisible(page, target);
});

test('Tab walk: every keyboard focus stop is fully in view and clear of the bar (FOC-02/05/06)', async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press('Tab'); // the skip link
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    const handle = await page.evaluateHandle(() => document.activeElement);
    const active = handle.asElement();
    // next dev's own tools button (a shadow host) is not part of the page; it doesn't exist in a build
    // past the last stop focus leaves the page (body); next dev's own tools button isn't part of the page
    if (!active || (await active.evaluate((n) => n === document.body || n.tagName === 'NEXTJS-PORTAL')))
      continue;
    await fullyVisibleHandle(page, active);
  }
});

test('a pointer press on a partly hidden control never scrolls the page (INT-07)', async ({ page }) => {
  await open(page);
  const target = page.getByRole('button', { name: 'Covered target', exact: true });
  // real wheel scroll until the button's top half sits just above the pinned bar and its bottom half under it
  const delta = await target.evaluate((b) => {
    const bar = document.querySelector('[aria-label="Pinned bar"]')!.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    return Math.round(r.top - bar.top + r.height / 2);
  });
  await page.mouse.move(10, 10);
  await page.mouse.wheel(0, delta);
  const before = await settledScrollY(page);
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 3);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await page.waitForTimeout(200);
  await expect(target).toBeFocused();
  expect(await scrollY(page)).toBe(before);
});

test('a human-speed click on a control that re-renders on press still lands (INT-06, whenFree)', async ({
  page,
}) => {
  await open(page);
  const chip = page.getByRole('button', { name: 'Swap chip' });
  for (let i = 1; i <= 3; i++) {
    const box = (await chip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
    await expect(page.getByRole('status', { name: 'Chip clicks' })).toHaveText(String(i));
    // the re-render the press asked for ran after the release (whenFree), with the click already counted
    await expect(page.getByRole('status', { name: 'Chip rebuilds' })).toHaveText(String(i));
  }
});

test('nextTabStop skips disabled, tabindex=-1, hidden, inert and unchecked-group radios (FOC-03)', async ({
  page,
}) => {
  await open(page);
  const fwd = page.getByRole('button', { name: 'Step forward' });
  await tabTo(page, fwd);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radio', { name: 'Radio one' })).toBeFocused();
  const back = page.getByRole('button', { name: 'Step back' });
  await tabTo(page, back);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radio', { name: 'Radio one' })).toBeFocused();
});

test('useReturnFocus: closing returns focus to the invoker (keyboard)', async ({ page }) => {
  await open(page);
  const opener = page.getByRole('button', { name: 'Open panel' });
  await tabTo(page, opener);
  await page.keyboard.press('Enter');
  const close = page.getByRole('button', { name: 'Close panel' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(opener).toBeFocused();
});

/** Real wheel scrolls until el's top sits at y (viewport px). */
async function wheelTo(page: Page, el: Locator, y: number) {
  await page.mouse.move(10, 10);
  for (let i = 0; i < 5; i++) {
    const box = (await el.boundingBox())!;
    const d = Math.round(box.y - y);
    if (Math.abs(d) < 2) return;
    await page.mouse.wheel(0, d);
    await page.waitForTimeout(250);
  }
}

test('holdStill: picking a tile while the error above goes leaves the tile under the pointer (VD11-02)', async ({
  page,
}) => {
  await open(page);
  const tile = page.getByRole('button', { name: 'Tile two' });
  await wheelTo(page, tile, 200);
  const before = (await tile.boundingBox())!;
  await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2, { delay: 90 });
  await expect(page.getByRole('alert', { name: '' }).getByText('Pick at least one time')).toHaveCount(0);
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
  const after = (await tile.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
});

test('holdStill: a picked tile under the send bar is lifted 8 px above it (VD12-02)', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 1024, 'the send bar is phone-only (hidden from 1024 px)');
  await open(page, 1, '?bar=send');
  const tile = page.getByRole('button', { name: 'Tile three' });
  const barTop = await page
    .getByRole('region', { name: 'Pinned bar' })
    .evaluate((b) => b.getBoundingClientRect().top);
  await wheelTo(page, tile, barTop - 10); // mostly under the bar, its top edge still clickable
  const box = (await tile.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + 4, { delay: 90 });
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
  const after = (await tile.boundingBox())!;
  expect(after.y + after.height).toBeLessThanOrEqual(barTop - 7);
});

test('announce speaks once through #live, and a repeat still changes the text', async ({ page }) => {
  await open(page);
  const say = page.getByRole('button', { name: 'Say saved' });
  const live = page.locator('#live');
  await say.click();
  await expect(live).toHaveText('Saved.');
  const first = await live.evaluate((n) => n.textContent);
  await say.click();
  const second = await live.evaluate((n) => n.textContent);
  expect(second).not.toBe(first);
  expect(second?.trim()).toBe('Saved.');
});

test('useInView: nothing ticks off-screen; ticks once half in view (FOC-01)', async ({ page }) => {
  await open(page);
  const box = page.getByRole('status', { name: 'In-view box' });
  await page.waitForTimeout(500);
  await expect(box).toHaveText(/out of view · not ticked/);
  const far = page.getByRole('button', { name: 'Move focus far' });
  await far.click(); // real click: moveFocus scrolls to the far target, past the box
  await page.mouse.wheel(0, -250);
  await expect(box).toHaveText(/in view · ticked/);
});

test('text size set before load: 200% on a phone flags big + huge text', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 500, 'phone widths only');
  await open(page, 2);
  await expect(page.locator('html')).toHaveAttribute('data-bigtext', '');
  await expect(page.locator('html')).toHaveAttribute('data-hugetext', '');
});

test('100% text at 1440: no big-text flags', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1000, 'desktop only');
  await open(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-bigtext', '');
});

test('resize: keeps a keyboard-focused field it hid, never a pointer-focused one (INT-08)', async ({
  page,
}) => {
  const size = page.viewportSize()!;
  await open(page);
  const top = page.getByRole('textbox', { name: 'Top field' });
  // pointer focus, scroll it away with the wheel, resize: the page stays put
  await top.click();
  await page.mouse.wheel(0, 600);
  const before = await settledScrollY(page);
  await page.setViewportSize({ width: size.width, height: size.height - 100 });
  await page.waitForTimeout(200);
  expect(await scrollY(page)).toBe(before);
  await page.setViewportSize(size);
});

test('resize: a keyboard-focused field the resize hides completely is brought back (INT-08)', async ({
  page,
}) => {
  const size = page.viewportSize()!;
  await open(page);
  const far = page.getByRole('button', { name: 'Far target' });
  await page.getByRole('button', { name: 'Move focus far' }).click();
  await expect(far).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab'); // keyboard focus on Far target
  await expect(far).toBeFocused();
  const box = (await far.boundingBox())!;
  // shrink the viewport so the focused control ends up completely below it
  await page.setViewportSize({ width: size.width, height: Math.max(200, Math.floor(box.y) - 20) });
  await page.waitForTimeout(300);
  const vh = await page.evaluate(() => window.innerHeight);
  const now = (await far.boundingBox())!;
  expect(now.y + now.height).toBeLessThanOrEqual(vh);
  await page.setViewportSize(size);
});

test('useInView: under half on screen counts as out of view (FOC-01)', async ({ page }) => {
  await open(page);
  const box = page.getByRole('status', { name: 'In-view box' });
  const vh = await page.evaluate(() => window.innerHeight);
  await wheelTo(page, box, vh - 60); // 60 of its 200 px on screen
  await page.waitForTimeout(500);
  await expect(box).toHaveText(/out of view · not ticked/);
});

test('resize: a keyboard-focused control the resize only partly hides is left alone (INT-08)', async ({
  page,
}) => {
  const size = page.viewportSize()!;
  await open(page);
  const far = page.getByRole('button', { name: 'Far target' });
  await page.getByRole('button', { name: 'Move focus far' }).click();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(far).toBeFocused();
  const before = await settledScrollY(page);
  const box = (await far.boundingBox())!;
  // the new bottom edge cuts through the control: partly hidden, not completely
  await page.setViewportSize({ width: size.width, height: Math.ceil(box.y + box.height / 2) });
  await page.waitForTimeout(300);
  expect(await scrollY(page)).toBe(before);
  await page.setViewportSize(size);
});

test('resize INSIDE the settle window of a keyboard focus: a partly hidden control is left alone (INT-08, pr72 F2)', async ({
  page,
}) => {
  const size = page.viewportSize()!;
  await open(page);
  const far = page.getByRole('button', { name: 'Far target' });
  await page.getByRole('button', { name: 'Move focus far' }).click();
  await expect(far).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await settledScrollY(page);
  // Tab onto the control, then resize at once: the focus's settle re-keep (a frame + 120 ms) is still pending
  await page.keyboard.press('Tab');
  const [box, before] = await far.evaluate(
    (n) => [n.getBoundingClientRect().toJSON(), window.scrollY] as const,
  );
  await page.setViewportSize({ width: size.width, height: Math.ceil(box.y + box.height / 2) });
  await page.waitForTimeout(600);
  await expect(far).toBeFocused();
  expect(await scrollY(page)).toBe(before);
  await page.setViewportSize(size);
});

test('script focus on a control cut off by the top edge brings it fully into view (FOC-04/06)', async ({
  page,
}) => {
  await open(page);
  const one = page.getByRole('button', { name: 'Tile one', exact: true });
  await wheelTo(page, one, -10);
  await page.getByRole('button', { name: 'Focus tile one' }).click({ delay: 90 });
  await expect(one).toBeFocused();
  await expect.poll(async () => (await one.boundingBox())!.y).toBeGreaterThanOrEqual(0);
});
