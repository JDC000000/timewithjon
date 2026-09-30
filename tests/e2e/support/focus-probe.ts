// Where is focus, and can a person see it? Reads the live page only (the design review's VIS probe, ported):
// `inView` = the share of the focused control's box inside the viewport AND every clipping ancestor;
// `coveredBy` = what sits on top of its centre (a sticky bar, a toast…), or null.
import type { Locator, Page } from '@playwright/test';
import { settle } from './input';
import { TARGET, type Target } from './screens';

export type FocusState = {
  name: string;
  tag: string;
  inView: number;
  coveredBy: string | null;
  top: number;
  bottom: number;
};

// Self-contained: Playwright serialises it into the page.
function visibility(el: Element): FocusState {
  const r = el.getBoundingClientRect();
  let clip = { l: 0, t: 0, r: innerWidth, b: innerHeight };
  for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const A = a.getBoundingClientRect();
    clip = {
      l: Math.max(clip.l, A.left + a.clientLeft),
      t: Math.max(clip.t, A.top + a.clientTop),
      r: Math.min(clip.r, A.left + a.clientLeft + a.clientWidth),
      b: Math.min(clip.b, A.top + a.clientTop + a.clientHeight),
    };
  }
  const w = Math.max(0, Math.min(r.right, clip.r) - Math.max(r.left, clip.l));
  const h = Math.max(0, Math.min(r.bottom, clip.b) - Math.max(r.top, clip.t));
  const inView = (w * h) / Math.max(1, r.width * r.height);
  const cx = Math.min(Math.max((r.left + r.right) / 2, 1), innerWidth - 1);
  const cy = Math.min(Math.max((r.top + r.bottom) / 2, 1), innerHeight - 1);
  const hit = inView > 0 ? document.elementFromPoint(cx, cy) : null;
  const covered = hit && !el.contains(hit) && !hit.contains(el);
  const label = (e: Element) =>
    (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
  return {
    name: label(el),
    tag: el.tagName.toLowerCase(),
    inView: Math.round(inView * 1000) / 1000,
    coveredBy: covered && hit ? label(hit) || hit.tagName : null,
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
  };
}

/** The focused element's state, or null when nothing (or <body>) has focus. */
export async function focusState(page: Page): Promise<FocusState | null> {
  const active = await page.evaluateHandle(() => {
    const el = document.activeElement;
    return el && el !== document.body && el !== document.documentElement ? el : null;
  });
  const element = active.asElement();
  const state = element ? await element.evaluate(visibility) : null;
  await active.dispose();
  return state;
}

/** The same state for any element (e.g. the toast), by locator. */
export async function elementState(target: Locator): Promise<FocusState> {
  return target.evaluate(visibility);
}

/** A person can see it: fully on screen (≥ 0.99, rounding) and nothing on top. */
export function isSeen(state: FocusState | null): boolean {
  return !!state && state.inView >= 0.99 && state.coveredBy === null;
}

/** Not hidden (WCAG 2.4.11): some part is on screen inside its scrollers, and nothing sits on its centre. */
export function isNotHidden(state: FocusState | null): boolean {
  return !!state && state.inView > 0 && state.coveredBy === null;
}

/**
 * The state of the toast that holds `undo`. On the app it is U1's Toast (src/ui/Toast.tsx): a `region` named by its
 * message line, found by role. The v1.12 pack mock's toast has no role, so on the pack target it is the nearest
 * ancestor of `undo` whose text matches `text` (the countdown).
 */
export async function toastState(
  page: Page,
  undo: Locator,
  text: RegExp,
  target: Target = TARGET,
): Promise<FocusState & { text: string }> {
  if (target === 'app') {
    const region = page.getByRole('region').filter({ has: undo });
    const [state, content] = await Promise.all([
      region.evaluate(visibility),
      region.evaluate((el) => el.textContent ?? ''),
    ]);
    return { ...state, text: content };
  }
  const handle = await undo.evaluateHandle((el, source) => {
    const pattern = new RegExp(source);
    let box: Element = el;
    while (box.parentElement && !pattern.test(box.textContent ?? '')) box = box.parentElement;
    return box;
  }, text.source);
  const element = handle.asElement();
  if (!element) throw new Error('toastState: no container');
  const state = await element.evaluate(visibility);
  const content = await element.evaluate((el) => el.textContent ?? '');
  await handle.dispose();
  return { ...state, text: content };
}

/**
 * Press `key` (Tab or Shift+Tab) until focus comes back to where it started (or `max` presses), recording every
 * stop. A person's full keyboard walk through the page (FOC-02, FOC-05, FOC-06).
 */
export async function tabWalk(page: Page, key: 'Tab' | 'Shift+Tab', max = 60): Promise<FocusState[]> {
  const stops: FocusState[] = [];
  let first: string | null = null;
  let previous: string | null = null;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    await settle(page);
    const state = await focusState(page);
    if (!state) continue;
    const id = `${state.tag}|${state.name}|${state.top + (await page.evaluate(() => Math.round(scrollY)))}`;
    // A date/time field takes one Tab per part (month, day, year): the same element again is not a new stop.
    if (id === previous) continue;
    previous = id;
    if (first === null) first = id;
    else if (id === first) break;
    stops.push(state);
  }
  return stops;
}
