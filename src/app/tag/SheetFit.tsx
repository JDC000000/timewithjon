'use client';
// src/app/tag/SheetFit.tsx — UX-14: the /tag preview's box (.sheet-fit). site.css scales the Letter page to the column with
// zoom: min(1, tan(atan2(100cqi, --letter-w))). Where an engine can't compute that, this measures the column and sets
// --sheet-k (the fallback the stylesheet already reads), so the page never scrolls sideways. Print resets zoom to 1.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

export const CSS_SCALE = 'tan(atan2(1px, 1px))';

/** The scale for a column `width` px wide and a Letter page `letter` px wide: never above 1 (never enlarged). */
export function sheetScale(width: number, letter: number): number {
  return letter > 0 && width > 0 ? Math.min(1, width / letter) : 1;
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
    if (!el || typeof ResizeObserver === 'undefined') return;
    if (typeof CSS !== 'undefined' && CSS.supports?.('zoom', CSS_SCALE)) return; // the stylesheet scales it
    const letter = parseFloat(getComputedStyle(el).getPropertyValue('--letter-w')) || 680;
    const fit = () => el.style.setProperty('--sheet-k', String(sheetScale(el.clientWidth, letter)));
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
