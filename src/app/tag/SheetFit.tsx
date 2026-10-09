'use client';
// src/app/tag/SheetFit.tsx — UX-14: the /tag preview's box (.sheet-fit). site.css scales the Letter page to the column with
// zoom: min(1, tan(atan2(100cqi, --letter-w))). r5: Firefox reports that value as supported (CSS.supports) yet doesn't
// apply it, so asking the engine isn't enough: this MEASURES. When the page is still wider than its column after layout,
// it sets data-fit="js" and --sheet-k (column / page), and site.css applies that zoom instead. Print resets zoom to 1.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/** The scale for a column `width` px wide and a Letter page `letter` px wide: never above 1 (never enlarged). */
export function sheetScale(width: number, letter: number): number {
  return letter > 0 && width > 0 ? Math.min(1, width / letter) : 1;
}

/** The stylesheet's scale didn't take: the page (as laid out) is wider than the column. */
export function overflows(pageWidth: number, columnWidth: number): boolean {
  return columnWidth > 0 && pageWidth > columnWidth + 1;
}

export function SheetFit(props: {
  style?: CSSProperties;
  label: string;
  describedBy: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    const page = el?.firstElementChild as HTMLElement | null | undefined;
    if (!el || !page || typeof ResizeObserver === 'undefined') return;
    const letter = parseFloat(getComputedStyle(el).getPropertyValue('--letter-w')) || 680;
    const fit = () => {
      // once the measured scale is on, it stays (re-measuring a scaled page would read it as fitting)
      if (el.dataset.fit !== 'js' && !overflows(page.getBoundingClientRect().width, el.clientWidth)) return;
      el.style.setProperty('--sheet-k', String(sheetScale(el.clientWidth, letter)));
      el.dataset.fit = 'js';
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={box}
      className="sheet-fit"
      style={props.style}
      role="img"
      aria-label={props.label}
      aria-describedby={props.describedBy}
    >
      {props.children}
    </div>
  );
}
