// src/ui/focus.ts (U1, decision 29): THE focus helper. Every focus move and every "keep it visible" scroll on the site
// goes through here; lanes never call element.focus() or scrollIntoView themselves (src/ui/CONTRACT.md §3).
// Re-implements the v1.12 pack's site.js TWJ.keep / focus / step / whenFree / byPointer / resizeMayKeep
// (VD9-01/02/03, VD10-02/03, VD11-03) for React. Cases: FOC-01..06, INT-06..08 (t4.3-carryover-focus-cases.md).
import { useEffect, useRef, useState, type DependencyList, type RefObject } from 'react';

export type FocusReason = 'script' | 'keyboard' | 'pointer';
export type FocusOrigin = 'pointer' | 'key' | 'script';

/** Pinned chrome that can cover a focused control (the pack's list; they grow with the text, scroll-padding can't follow). */
const PINNED = '.tabbar, .actbar, .sbar, .toast';
const TAB_STOPS = 'a[href], button, input, select, textarea, summary, [tabindex]';
export const TEXT_SIZE_EVENT = 'twj:textsize';
/** A press counts as the cause of a focus for this long after pointerdown (the pack's 700 ms). */
const PRESS_WINDOW_MS = 700;
/** Gap kept between a lifted control and the bar that covered it. */
const LIFT_GAP_PX = 8;
/** Second keep after layout settles (WebKit's late scroll restore after Back, a sheet opening). */
const SETTLE_MS = 120;
/** "Big text" = the page is under 17em wide (200% text on a phone, 125% at 320); "huge" = under 13em. */
const BIG_TEXT_EM = 17;
const HUGE_TEXT_EM = 13;
const SCROLL_KEYS = /^(PageUp|PageDown|Home|End|ArrowUp|ArrowDown| )$/;
const OWN_KEYS = 'input, textarea, select, [role=tablist], [role=radiogroup], [role=menu]';

const hasDom = () => typeof document !== 'undefined';
const now = () => Date.now();

// ---- module state (one page = one set of listeners) ----
let pointerDown = false;
let afterPointer: Array<() => void> = [];
let lastPress: { at: number; el: Element | null } = { at: -1e9, el: null };
let lastKeyAt = -1e9;
let lastUserScrollAt = -1e9;
/** The last viewport resize: after one, only the resize rule (resizeMayKeep) may scroll for the current focus. */
let lastResizeAt = -1e9;
let origin: FocusOrigin = 'script';
let focusAt = 0;
let pointerFocusFor: Element | null = null;
let lastSaid = '';

function isScroller(el: Element): boolean {
  const oy = getComputedStyle(el).overflowY;
  return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight;
}

function scrollerOf(el: Element): Element | null {
  for (
    let s = el.parentElement;
    s && s !== document.body && s !== document.documentElement;
    s = s.parentElement
  ) {
    if (isScroller(s)) return s;
  }
  return null;
}

function isInlineScroller(el: Element): boolean {
  const ox = getComputedStyle(el).overflowX;
  return (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth;
}

/**
 * FOC-06, the inline axis (A2's filter row): bring el fully inside its nearest horizontal scroller, inside that
 * scroller's scroll-padding-inline, instantly (never a glide, like the vertical path). A control wider than the
 * scroller aligns its start. The vertical pass below never did this: it only acts when el is out of view
 * vertically, and a tab off the right edge of a one-line row is in view vertically.
 * Scope (pr79-review F2/F5): any ancestor that actually scrolls on x counts (overflow-y:auto makes overflow-x auto
 * too, so .rail, dialog.sheet and .adm-list do whenever they overflow sideways; today only .filters is authored to),
 * and only the nearest one is corrected (no nested x-scrollers exist).
 */
function keepInline(el: Element): void {
  let sc: Element | null = el.parentElement;
  while (sc && sc !== document.body && !isInlineScroller(sc)) sc = sc.parentElement;
  if (!sc || sc === document.body) return;
  const cs = getComputedStyle(sc);
  const q = sc.getBoundingClientRect();
  // scroll-padding in px (site.css uses lengths; a % value would need resolving against sc.clientWidth: F3)
  const left = q.left + (parseFloat(cs.scrollPaddingLeft) || 0);
  const right = q.right - (parseFloat(cs.scrollPaddingRight) || 0);
  const r = el.getBoundingClientRect();
  let d = 0;
  if (r.left < left || r.width > right - left) d = r.left - left;
  else if (r.right > right) d = r.right - right;
  // whole pixels, rounded outward: a fractional edge must not stay a hair outside (pr82-review F3)
  if (d) sc.scrollBy({ left: d > 0 ? Math.ceil(d) : Math.floor(d), behavior: 'instant' });
}

function scrollNearest(el: Element): void {
  try {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  } catch {
    el.scrollIntoView(false);
  }
}

/**
 * Bring el fully into view (its own scroller first, then the page; instantly: a smooth glide leaves it off-screen
 * mid-way), then lift it above any fixed/sticky pinned bar covering it (FOC-05, FOC-06, 2.4.11).
 */
export function keepVisible(el: Element | null | undefined): void {
  if (!hasDom() || !el || !el.getClientRects().length) return;
  keepInline(el);
  let r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const sc = scrollerOf(el);
  const q = sc ? sc.getBoundingClientRect() : null;
  const lo = Math.max(0, q ? q.top : 0);
  const hi = Math.min(vh, q ? q.bottom : vh);
  const outOfView = r.bottom <= lo || r.top >= hi;
  const partlyButFits = (r.top < lo || r.bottom > hi) && r.height <= hi - lo;
  if (outOfView || partlyButFits) {
    scrollNearest(el);
    r = el.getBoundingClientRect();
    // FOC-04: scroll offsets snap to whole pixels, so a fractional edge can stay a hair outside (e.g. 900.3 of 900
    // at 200 % text): nudge one pixel inward when the other edge has room for it
    const nudge = r.bottom > hi && r.top - 1 >= lo ? 1 : r.top < lo && r.bottom + 1 <= hi ? -1 : 0;
    if (nudge) {
      // its own scroller first; one already at its end can't move, so then the page (pr82-review F2)
      const t0 = sc?.scrollTop;
      (sc ?? window).scrollBy({ top: nudge, behavior: 'instant' });
      if (sc && sc.scrollTop === t0) window.scrollBy({ top: nudge, behavior: 'instant' });
      r = el.getBoundingClientRect();
    }
  }
  let barTop = Infinity;
  document.querySelectorAll(PINNED).forEach((bar) => {
    if (bar.contains(el) || !bar.getClientRects().length) return;
    const pos = getComputedStyle(bar).position;
    if (pos !== 'fixed' && pos !== 'sticky') return;
    const b = bar.getBoundingClientRect();
    const overlaps = b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
    if (overlaps && b.bottom >= r.bottom - 1) barTop = Math.min(barTop, b.top);
  });
  if (barTop === Infinity) return;
  const d = Math.ceil(r.bottom - barTop) + LIFT_GAP_PX;
  for (let s = el.parentElement; s && s !== document.body; s = s.parentElement) {
    if (!isScroller(s)) continue;
    const before = s.scrollTop;
    s.scrollBy({ top: d, behavior: 'instant' });
    if (s.scrollTop !== before) return;
  }
  window.scrollBy({ top: d, behavior: 'instant' });
}

/**
 * THE way to move focus. 'script'/'keyboard': focus without the browser's own jump, then keepVisible.
 * 'pointer': focus only; the control is already under the finger and a scroll would lose the tap (INT-07).
 */
export function moveFocus(el: HTMLElement | null | undefined, reason: FocusReason = 'script'): void {
  if (!hasDom() || !el) return;
  if (reason === 'keyboard') lastKeyAt = now();
  if (reason === 'pointer') pointerFocusFor = el;
  el.focus({ preventScroll: true });
  pointerFocusFor = null;
  if (reason !== 'pointer') keepVisible(el);
}

/** True when focus on el came from a pointer press on el (or its label) and not from a later key press. */
export function byPointer(el: Element): boolean {
  const pe = lastPress.el;
  if (!pe || !(pointerDown || now() - lastPress.at < PRESS_WINDOW_MS) || lastKeyAt > lastPress.at)
    return false;
  if (pe === el || el.contains(pe) || pe.contains(el)) return true;
  const label = pe.closest('label');
  return !!(label && (label.control === el || label.contains(el)));
}

/** Where the current focus came from (set on every focusin). */
export function focusOrigin(): FocusOrigin {
  return origin;
}

function isTabStop(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled || el.tabIndex < 0) return false;
  if (el.closest('[inert], [hidden]') || !el.getClientRects().length) return false;
  if (getComputedStyle(el).visibility === 'hidden') return false;
  if (el instanceof HTMLInputElement && el.type === 'radio' && !el.checked) {
    const scope = el.form ?? document;
    const group = Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type=radio]`)).filter(
      (x) => x.name === el.name,
    );
    if (group.some((x) => x.checked) || group[0] !== el) return false;
  }
  return true;
}

/** Every Tab stop inside root, in order (a sheet keeps Tab inside itself with it). */
export function tabStops(root: ParentNode): HTMLElement[] {
  if (!hasDom()) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(TAB_STOPS)).filter(isTabStop);
}

/** The next (1) or previous (-1) Tab stop after `from`, in page order (FOC-03: leaving a popup the way Tab would). */
export function nextTabStop(from: Element, dir: 1 | -1): HTMLElement | null {
  if (!hasDom()) return null;
  const all = tabStops(document);
  const i = all.indexOf(from as HTMLElement);
  if (i < 0) return null;
  return all[i + dir] ?? null;
}

/**
 * VD11-02 + VD12-02 (the pack's holdStill): run fn (a change above el, e.g. an error line going; pass
 * `() => flushSync(...)` so React commits inside it) without moving el on screen: the page scrolls by el's shift.
 * Then, if a fixed/sticky send bar (.sbar) covers el, el is lifted to sit 8 px above it (by the covered height only).
 */
export function holdStill(el: Element | null | undefined, fn: () => void): void {
  if (!hasDom() || !el) {
    fn();
    return;
  }
  const y0 = el.getBoundingClientRect().top;
  fn();
  const dy = el.getBoundingClientRect().top - y0;
  if (dy >= 1 || dy <= -1) window.scrollBy({ top: dy, behavior: 'instant' });
  const bar = document.querySelector('.sbar');
  if (!(bar instanceof HTMLElement) || bar.hidden || !bar.getClientRects().length) return;
  const pos = getComputedStyle(bar).position;
  if (pos !== 'fixed' && pos !== 'sticky') return;
  const r = el.getBoundingClientRect();
  const q = bar.getBoundingClientRect();
  if (q.top < r.bottom && q.bottom >= r.bottom - 1 && q.left < r.right && q.right > r.left) {
    window.scrollBy({ top: Math.ceil(r.bottom - q.top) + LIFT_GAP_PX, behavior: 'instant' });
  }
}

/** Run fn now, or just after the pending pointer is released (after its click): INT-06, no lost clicks. */
export function whenFree(fn: () => void): void {
  if (!pointerDown) fn();
  else if (!afterPointer.includes(fn)) afterPointer.push(fn);
}

/**
 * THE resize rule (INT-08, VD11-03): a resize may scroll the page only for a keyboard/script-focused control that the
 * resize hid completely, and never once the user has scrolled since that focus.
 */
export function resizeMayKeep(el: Element | null | undefined): boolean {
  if (!hasDom() || !el || el === document.body || el === document.documentElement) return false;
  if (origin === 'pointer' || pointerDown || lastUserScrollAt > focusAt) return false;
  const r = el.getBoundingClientRect();
  return !(r.bottom > 0 && r.top < window.innerHeight);
}

/** Subscribe to text-size changes (the probe fires TEXT_SIZE_EVENT). Returns the unsubscribe. */
export function onTextSize(fn: () => void): () => void {
  if (!hasDom()) return () => {};
  document.addEventListener(TEXT_SIZE_EVENT, fn);
  return () => document.removeEventListener(TEXT_SIZE_EVENT, fn);
}

/** Speak msg once through the page's one polite live region (#live, rendered by FocusRoot). */
export function announce(msg: string): void {
  const live = hasDom() ? document.getElementById('live') : null;
  if (!live) return;
  // the same words twice in a row are only re-read if the text node changes: alternate a trailing no-break space
  const text = msg === lastSaid.replace(/ $/, '') && !lastSaid.endsWith(' ') ? `${msg} ` : msg;
  live.textContent = '';
  live.textContent = text;
  lastSaid = text;
}

// ---- global listeners (installed once by FocusRoot) ----
function onPointerDown(e: PointerEvent) {
  pointerDown = true;
  lastPress = { at: now(), el: e.target instanceof Element ? e.target : null };
}
function onPointerUp() {
  if (!pointerDown) return;
  pointerDown = false;
  setTimeout(() => {
    const queued = afterPointer;
    afterPointer = [];
    queued.forEach((f) => f());
  }, 0);
}
function onKeyDown(e: KeyboardEvent) {
  lastKeyAt = now();
  const t = e.target instanceof Element ? e.target : null;
  if (SCROLL_KEYS.test(e.key) && !(t && t.closest(OWN_KEYS))) lastUserScrollAt = now();
}
function onUserScroll() {
  lastUserScrollAt = now();
}
function onFocusIn(e: FocusEvent) {
  const t = e.target;
  if (!(t instanceof Element)) return;
  focusAt = now();
  origin =
    pointerFocusFor === t || byPointer(t)
      ? 'pointer'
      : focusAt - lastKeyAt < PRESS_WINDOW_MS
        ? 'key'
        : 'script';
  if (origin === 'pointer') return; // INT-07: never scroll under a press
  keepVisible(t);
  // The settle re-keeps (a frame, then SETTLE_MS) never run after a resize or a user scroll since this focus: a late
  // one would scroll a partly hidden control under the resize rule's feet (INT-08, pr72-review F2) or fight the user.
  // The viewport size is compared too: WebKit can run the settle frame after the viewport changed but before it
  // dispatches the resize event.
  const at = focusAt;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const settle = () => {
    if (document.activeElement !== t || pointerDown) return;
    if (lastResizeAt > at || lastUserScrollAt > at) return;
    if (window.innerWidth !== vw || window.innerHeight !== vh) return;
    keepVisible(t);
  };
  requestAnimationFrame(() => {
    settle();
    setTimeout(settle, SETTLE_MS);
  });
}
function onResizeMark() {
  lastResizeAt = now();
}
function keepActive(e?: Event) {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement || origin === 'pointer' || pointerDown)
    return;
  if (e?.type === 'resize' && !resizeMayKeep(a)) return;
  requestAnimationFrame(() => {
    if (document.activeElement === a) keepVisible(a);
  });
}

/**
 * Installs the page-wide focus rules and the text-size probe (FocusRoot calls it once; returns the uninstall).
 * probe = a 1rem-wide element (.rem-probe): its width is the current text size.
 */
export function installFocusGuard(probe: HTMLElement | null): () => void {
  if (!hasDom()) return () => {};
  const opts = { passive: true, capture: true } as const;
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
  window.addEventListener('blur', onPointerUp);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('wheel', onUserScroll, opts);
  window.addEventListener('touchmove', onUserScroll, opts);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener(TEXT_SIZE_EVENT, keepActive);
  // capture: marked before any other resize handler runs
  window.addEventListener('resize', onResizeMark, true);
  window.addEventListener('resize', keepActive);

  let lastRem = 0;
  const fit = () => {
    if (!probe) return;
    const rem = probe.getBoundingClientRect().width || 16;
    const em = window.innerWidth / rem;
    const root = document.documentElement;
    if (rem !== lastRem) {
      const first = lastRem === 0;
      lastRem = rem;
      if (!first) document.dispatchEvent(new Event(TEXT_SIZE_EVENT));
    }
    root.toggleAttribute('data-bigtext', em < BIG_TEXT_EM);
    root.toggleAttribute('data-hugetext', em < HUGE_TEXT_EM);
  };
  fit();
  window.addEventListener('resize', fit);
  const ro =
    probe && 'ResizeObserver' in window ? new ResizeObserver(() => requestAnimationFrame(fit)) : null;
  if (ro && probe) ro.observe(probe);

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerUp, true);
    window.removeEventListener('blur', onPointerUp);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('wheel', onUserScroll, opts);
    window.removeEventListener('touchmove', onUserScroll, opts);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener(TEXT_SIZE_EVENT, keepActive);
    window.removeEventListener('resize', onResizeMark, true);
    window.removeEventListener('resize', keepActive);
    window.removeEventListener('resize', fit);
    ro?.disconnect();
  };
}

// ---- hooks ----

/**
 * Records the invoker (the focused element) when `open` turns true and returns focus to it when `open` turns false.
 * Call it BEFORE the effect that moves focus into the opened thing (effects run in call order).
 */
export function useReturnFocus(open: boolean): void {
  const invoker = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      const a = document.activeElement;
      invoker.current = a instanceof HTMLElement && a !== document.body ? a : null;
      return;
    }
    const el = invoker.current;
    invoker.current = null;
    if (el?.isConnected) moveFocus(el);
  }, [open]);
}

/** True while at least `ratio` of the element is on screen (IntersectionObserver). FOC-01: the undo countdown. */
export function useInView<T extends Element>(ref: RefObject<T | null>, ratio = 0.5): boolean {
  // no IntersectionObserver (very old engines): treat it as in view, so the countdown still runs
  const [seen, setSeen] = useState(
    () => typeof window !== 'undefined' && !('IntersectionObserver' in window),
  );
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setSeen(last.intersectionRatio >= ratio);
      },
      { threshold: [0, ratio, Math.min(1, ratio + 0.01), 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, ratio]);
  return seen;
}

/** FOC-04: after a state swap / submit / navigation, move focus (script) to ref once it renders; re-runs on deps. */
export function useLandingFocus(ref: RefObject<HTMLElement | null>, deps: DependencyList): void {
  useEffect(() => {
    moveFocus(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
