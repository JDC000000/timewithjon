'use client';
// src/app/admin/_season/ListLanding.tsx — T2.5.U1, FOC-04 on the A4 list: after away mode saves (or turns off) focus
// lands on the away card's Edit link, which now shows the new range, and "Away mode saved." is spoken; after Back from
// a week it lands on that week's row (the browser has already put it back on screen). Otherwise focus stays put.
import { useEffect, useRef, type ReactNode } from 'react';
import { AWAY } from '@/content/ui/admin-season';
import { announce, moveFocus } from '@/ui/focus';
import { AWAY_PATH, LAST_WEEK_KEY, SEASON_PATH, weekPath } from './paths';

export function ListLanding({ saved, children }: { saved: 'away' | 'off' | null; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    let last: string | null = null;
    try {
      last = sessionStorage.getItem(LAST_WEEK_KEY);
      sessionStorage.removeItem(LAST_WEEK_KEY);
    } catch {
      /* private mode */
    }
    const href = saved ? AWAY_PATH : last ? weekPath(last) : null;
    const target = href ? root.querySelector<HTMLElement>(`a[href="${href}"]`) : null;
    moveFocus(target);
    if (saved === 'away') announce(AWAY.saved);
    // a reload doesn't repeat it
    if (saved) window.history.replaceState(window.history.state, '', SEASON_PATH);
  }, [saved]);
  return <div ref={box}>{children}</div>;
}
