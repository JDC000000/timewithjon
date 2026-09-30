'use client';
// The desktop rail (pack gen.py rail(), s07 rl): the dish, "Your picks" (a Remove per pick), "Your dates" or
// "Your pitch", and the way back to the menu. Keys are stable ids (slot ids, dates), so a Remove never rebuilds
// another row under a pending click (INT-06).
import Link from 'next/link';
import { KeepWhole, ROUTES } from '@/ui';
import { RAIL } from '@/content/ui/booking';
import type { DishView } from './_lib/flow-view';

export interface RailItem {
  key: string;
  label: string;
}

/** The pack's rail shows the dish detail in two lines: the time, then who it serves. */
export function railDetailLines(detail: string): string[] {
  const at = detail.lastIndexOf(' · serves ');
  return at < 0 ? [detail] : [detail.slice(0, at), detail.slice(at + ' · '.length)];
}

export function PicksRail({
  dish,
  heading = RAIL.yourPicks,
  items,
  empty = null,
  onRemove,
}: {
  dish: DishView;
  heading?: string;
  items: RailItem[];
  /** The line while the list is empty ("Tap a time on the left."); none: an empty list. */
  empty?: string | null;
  /** A Remove per item (the S6 picks); none: a plain list (pack s07). */
  onRemove?: (key: string) => void;
}) {
  return (
    <aside className="rail" aria-labelledby="rail-h">
      <div className="rail-card">
        <p className="cap">{dish.course}</p>
        <p className="dish-name" id="rail-h">
          {dish.name}
        </p>
        <p className="detail" style={{ marginTop: 'var(--s1)' }}>
          {railDetailLines(dish.detail).map((line) => (
            <span key={line} className="dl" style={{ display: 'block' }}>
              <KeepWhole text={line} />
            </span>
          ))}
        </p>
        <h2>{heading}</h2>
        <ul className="picks">
          {items.length === 0
            ? empty && <li className="empty">{empty}</li>
            : items.map((t) => (
                <li key={t.key}>
                  <span>
                    <KeepWhole text={t.label} />
                  </span>
                  {onRemove && (
                    <button type="button" className="textbtn rm" onClick={() => onRemove(t.key)}>
                      {RAIL.remove}
                      <span className="vh"> {t.label}</span>
                    </button>
                  )}
                </li>
              ))}
        </ul>
        <p className="links">
          <Link className="tap" href={ROUTES.menu}>
            {RAIL.otherDish}
          </Link>
        </p>
      </div>
    </aside>
  );
}
