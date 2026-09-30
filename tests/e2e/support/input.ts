// Real input only (decision 29): the keyboard and the mouse/touchscreen, never element.focus(),
// scrollIntoView() or injected state. Reading the page (geometry, the focused element) is fine.
import type { Locator, Page } from '@playwright/test';

/** Two animation frames: lets focus handlers, scroll and layout settle after an input. */
export async function settle(page: Page): Promise<void> {
  try {
    // Two frames, or 500 ms when the renderer produces none (a stalled frame must not hang the case).
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          const fallback = setTimeout(done, 500);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              clearTimeout(fallback);
              done();
            }),
          );
        }),
    );
  } catch (error) {
    // The input navigated (a link, a submit): wait for the new page instead.
    if (!/context was destroyed|navigat/i.test(String(error))) throw error;
    await page.waitForLoadState();
    await settle(page);
  }
}

export async function press(page: Page, key: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await settle(page);
  }
}

/**
 * A human-speed click at a point: move, press, hold (~90 ms, INT-06), release. No auto-scroll: the point must be
 * where a person would click. Use it for re-rendering controls and partly visible ones (INT-06, INT-07).
 */
export async function humanClickAt(page: Page, x: number, y: number, holdMs = 90): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await settle(page);
}

/** The centre of the visible part of a control, or an error when it is off screen. */
async function visibleCentre(page: Page, target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error('humanClick: the control has no box (hidden?)');
  const view = page.viewportSize() ?? { width: 0, height: 0 };
  const top = Math.max(box.y, 0);
  const bottom = Math.min(box.y + box.height, view.height);
  const left = Math.max(box.x, 0);
  const right = Math.min(box.x + box.width, view.width);
  if (bottom <= top || right <= left) throw new Error('humanClick: the control is off screen');
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/**
 * A human-speed click on a control that is (at least partly) on screen, aimed the way a hand and eye do it: the
 * pointer travels there, the page reacts to the hover (a toast pauses, a label swaps), then the person aims at where
 * the control is now and presses (~90 ms hold, INT-06). A change DURING the press is what INT-06 guards.
 */
export async function humanClick(page: Page, target: Locator, holdMs = 90): Promise<void> {
  await scrollStill(page);
  const first = await visibleCentre(page, target);
  await page.mouse.move(first.x, first.y, { steps: 4 });
  await settle(page);
  const { x, y } = await visibleCentre(page, target);
  // A person's click lands on whatever is on top: say so instead of clicking something else.
  const cover = await target.evaluate(
    (el, [px, py]) => {
      const hit = document.elementFromPoint(px ?? 0, py ?? 0);
      if (!hit || el.contains(hit) || (el instanceof HTMLInputElement && el.labels?.[0]?.contains(hit)))
        return null;
      return hit.outerHTML.slice(0, 80);
    },
    [x, y],
  );
  if (cover) throw new Error(`humanClick: the control is covered at its visible centre by ${cover}`);
  await humanClickAt(page, x, y, holdMs);
}

/**
 * A person scrolls with the wheel (not window.scrollTo). The wheel scrolls whatever is under the pointer, so it rests
 * at `at` (default: the middle of the screen) first.
 */
export async function wheel(page: Page, deltaY: number, at?: { x: number; y: number }): Promise<void> {
  const view = page.viewportSize() ?? { width: 400, height: 800 };
  const point = at ?? { x: view.width / 2, y: view.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, deltaY);
  await scrollStill(page);
}

/**
 * Wait until the page stops scrolling (the same scroll position for 4 frames in a row, at most 3 s): wheel scrolling
 * and `scroll-behavior: smooth` animate, and a box read mid-animation sends the next click to the wrong place.
 */
export async function scrollStill(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const started = performance.now();
        let last = '';
        let still = 0;
        const read = () =>
          [
            window.scrollY,
            ...[...document.querySelectorAll('*')]
              .filter((e) => e.scrollTop || e.scrollLeft)
              .map((e) => e.scrollTop + e.scrollLeft),
          ].join();
        const frame = () => {
          const now = read();
          still = now === last ? still + 1 : 0;
          last = now;
          if (still >= 4 || performance.now() - started > 3000) done();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
}

/** Is the control fully on screen with nothing on its centre (a sticky bar, a toast)? Reads geometry only. */
async function comfortablyInView(target: Locator): Promise<boolean> {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const fits =
      r.height >= innerHeight ? r.top <= 0 && r.bottom >= innerHeight : r.top >= 0 && r.bottom <= innerHeight;
    if (!fits) return false;
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      Math.max(0, r.top) + Math.min(r.height, innerHeight) / 2,
    );
    return !!hit && (el.contains(hit) || (el instanceof HTMLInputElement && !!el.labels?.[0]?.contains(hit)));
  });
}

/**
 * Where a person would put the pointer to scroll a control into view, and how far: the visible middle of the control's
 * nearest scrolling box (an inner list such as /admin/requests' 100vh `.adm-list`, or the page itself when there is
 * none), and the control's distance from that middle. `pos` sums the page's and every ancestor's scroll offset, so a
 * wheel that moved nothing is seen whichever box took it.
 */
async function wheelAim(
  target: Locator,
): Promise<{ at: { x: number; y: number }; deltaY: number; pos: number }> {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    let box: Element | null = null;
    let pos = scrollY;
    for (
      let p = el.parentElement;
      p && p !== document.body && p !== document.documentElement;
      p = p.parentElement
    ) {
      pos += p.scrollTop;
      if (
        box ||
        !/auto|scroll|overlay/.test(getComputedStyle(p).overflowY) ||
        p.scrollHeight <= p.clientHeight
      )
        continue;
      // Only a box that is on screen and whose visible part cuts the control off; one that already shows it whole
      // leaves the scrolling to the page.
      const q = p.getBoundingClientRect();
      const [qTop, qBottom] = [Math.max(q.top, 0), Math.min(q.bottom, innerHeight)];
      if (qBottom > qTop && (r.top < qTop || r.bottom > qBottom)) box = p;
    }
    const b = box?.getBoundingClientRect();
    const top = Math.max(b?.top ?? 0, 0);
    const bottom = Math.min(b?.bottom ?? innerHeight, innerHeight);
    const left = Math.max(b?.left ?? 0, 0);
    const right = Math.min(b?.right ?? innerWidth, innerWidth);
    const mid = bottom > top ? (top + bottom) / 2 : innerHeight / 2;
    const at =
      right > left && bottom > top ? { x: (left + right) / 2, y: mid } : { x: innerWidth / 2, y: mid };
    return { at, deltaY: Math.round(r.top + r.height / 2 - mid), pos };
  });
}

/**
 * Scroll the way a person does, with the wheel, until the control is fully on screen and uncovered, aiming for the
 * middle of the screen (FOC-01: "Lock in" sits below the fold at 320 px + 200 % text; S6's sticky bar covers the
 * bottom edge). The pointer rests over the box that scrolls the control (an inner list or the page), as a hand does.
 * Never scrollIntoView(): the page's own scroll handling must stay in play.
 */
export async function wheelTo(page: Page, target: Locator, maxSteps = 12): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    await scrollStill(page);
    if (await comfortablyInView(target)) return;
    if (!(await target.boundingBox())) throw new Error('wheelTo: the control has no box (hidden?)');
    const { at, deltaY, pos } = await wheelAim(target);
    await wheel(page, deltaY, at);
    if ((await wheelAim(target)).pos === pos) return; // nothing can scroll further: click what shows
  }
}

/** Wheel to a control, then click it at human speed (the default way a case activates something). */
export async function clickLikeAPerson(page: Page, target: Locator): Promise<void> {
  await wheelTo(page, target);
  await humanClick(page, target);
}

/** Click into a field like a person and type into it, key by key. */
export async function typeLikeAPerson(page: Page, field: Locator, text: string): Promise<void> {
  await clickLikeAPerson(page, field);
  await page.keyboard.type(text, { delay: 5 });
  await settle(page);
}
