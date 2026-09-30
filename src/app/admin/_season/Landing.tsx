'use client';
// src/app/admin/_season/Landing.tsx — FOC-04 for the A6/A7 list + detail panes (lane U6): arriving on a detail
// (navigation, Back, reload, or after a submit that navigates) lands focus on its heading, and remembers the detail
// so Back to the list lands on that row. An arrival with news (`say`) speaks it once and drops the query, so a reload
// doesn't repeat it. All focus moves go through @/ui/focus (decision 29).
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { announce, moveFocus, useLandingFocus } from '@/ui/focus';

function remember(key: string, href: string | null): string | null {
  try {
    if (href === null) {
      const last = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
      return last;
    }
    sessionStorage.setItem(key, href);
  } catch {
    /* private mode */
  }
  return null;
}

/** The detail's title: focus lands here; `say` (if any) is announced and the query dropped. */
export function LandingHeading({
  returnKey,
  href,
  say,
  land = true,
  className = 'h2',
  style,
  children,
}: {
  returnKey: string;
  href: string;
  say?: string | null;
  /** false when the pane isn't the arrival (e.g. the desktop's default pane beside a list) */
  land?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLandingFocus(land ? ref : { current: null }, [href, land]);
  useEffect(() => {
    if (land) remember(returnKey, href);
    if (!say) return;
    announce(say);
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [returnKey, href, say, land]);
  return (
    <h2 ref={ref} tabIndex={-1} className={className} style={style}>
      {children}
    </h2>
  );
}

/** Wraps a list pane: after Back from a detail, focus lands on that detail's row link (or the title if it's gone). */
export function ListReturn({ returnKey, children }: { returnKey: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const href = remember(returnKey, null);
    if (!href) return;
    // the row may be gone (a deleted story): then the list's title
    const root = box.current;
    moveFocus(
      root?.querySelector<HTMLElement>(`a[href="${href}"]`) ?? root?.querySelector<HTMLElement>('h1') ?? null,
    );
  }, [returnKey]);
  return <div ref={box}>{children}</div>;
}
