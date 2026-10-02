'use client';
// src/app/menu/CourseBar.tsx — S04b the sticky course bar (T1.3.U3, R1-16; J.06 G0.5 default "as drawn": kept).
// It upgrades the S04 Courses nav that Menu renders (one `nav aria-label="Courses"` landmark, never a second one):
// site.css S04b pins it to the top of the screen; this marks the course in view with aria-current and, when a link
// is activated, lets the browser follow the #hash (scroll-padding keeps the heading below the bar) and then moves
// focus to that course's heading through the focus helper (src/ui/CONTRACT.md §3). Renders nothing itself.
import { useEffect } from 'react';
import { moveFocus } from '@/ui/focus';

/** A scroll counts as settled after this many quiet ticks (a smooth hash scroll may start a frame late). */
const QUIET_TICKS = 5;
const TICK_MS = 16;
/** Focus lands anyway after this long (a scroll that never settles, e.g. a user flick mid-glide). */
const SETTLE_CAP_MS = 1500;
const BAR_VAR = '--course-bar-h';

/** Run fn once the page scroll has stopped moving (or after SETTLE_CAP_MS). Returns a cancel. */
function whenScrollRests(fn: () => void): () => void {
  let last = window.scrollY;
  let quiet = 0;
  const started = Date.now();
  let timer = 0;
  const tick = () => {
    const y = window.scrollY;
    quiet = y === last ? quiet + 1 : 0;
    last = y;
    if (quiet >= QUIET_TICKS || Date.now() - started >= SETTLE_CAP_MS) fn();
    else timer = window.setTimeout(tick, TICK_MS);
  };
  timer = window.setTimeout(tick, TICK_MS);
  return () => window.clearTimeout(timer);
}

export function CourseBar() {
  useEffect(() => {
    const nav = document.querySelector('.course-nav')?.closest('nav');
    if (!nav) return;
    const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
    const sections = links.map((a) => document.getElementById(a.getAttribute('href')!.slice(1)));
    const root = document.documentElement;
    let current = -1;
    let held = -1; // the course just activated: kept current until its jump settles
    let cancel: (() => void) | null = null;

    const mark = (i: number) => {
      if (i === current) return;
      current = i;
      links.forEach((a, k) => {
        if (k === i) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    };
    // the course in view = the last one whose top has reached the bar's foot (the first until then)
    const pick = () => {
      if (held >= 0) return mark(held);
      const edge = nav.getBoundingClientRect().bottom + 1;
      let i = 0;
      sections.forEach((s, k) => {
        if (s && s.getBoundingClientRect().top <= edge) i = k;
      });
      mark(i);
    };
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(pick);
    };
    const onClick = (e: MouseEvent) => {
      const k = links.indexOf((e.target as Element | null)?.closest('a') as HTMLAnchorElement);
      const heading = sections[k]?.querySelector<HTMLElement>('h2');
      if (k < 0 || !heading) return;
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      held = k;
      mark(k);
      cancel?.();
      // no preventDefault: the browser follows the #hash (history + scroll), then focus lands once it rests
      cancel = whenScrollRests(() => {
        cancel = null;
        held = -1;
        moveFocus(heading, 'script');
      });
    };
    // publish the bar's height: html's scroll-padding-top clears it (S04b), so a jump or a Tab never hides under it
    const measure = () =>
      root.style.setProperty(BAR_VAR, `${Math.ceil(nav.getBoundingClientRect().height)}px`);
    const ro = 'ResizeObserver' in window ? new ResizeObserver(measure) : null;
    ro?.observe(nav);
    measure();
    pick();
    nav.addEventListener('click', onClick);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancel?.();
      cancelAnimationFrame(frame);
      ro?.disconnect();
      nav.removeEventListener('click', onClick);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      root.style.removeProperty(BAR_VAR);
    };
  }, []);
  return null;
}
