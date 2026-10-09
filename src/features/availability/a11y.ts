// src/features/availability/a11y.ts — T1.5 AC5: a time tile's accessible name is the pack v1.12 one (VD6-09):
// "Thu noon–2 pm, May 6" / "Fri 7 pm, May 7". Selection is spoken by aria-pressed, never by the name.
// ONE source for the picker tiles (src/app/book), the pack and the E2E selectors.
// The picker's client code builds these names, so they come from the civil date itself (src/lib/civil.ts, no
// date-fns): the weekday and day of a Vancouver civil date are the same at any hour.
import { monthDay, weekdayShort } from '@/lib/civil';
import type { WindowOut } from '@/features/availability/types';
import { WINDOW_WORDS } from '@/content/ui/booking';

export interface WindowNameParts {
  /** The visible weekday, "Thu". */
  day: string;
  /** The rest, spoken whole: "noon–2 pm, May 6". */
  rest: string;
}

export function windowNameParts(w: Pick<WindowOut, 'date' | 'window'>): WindowNameParts {
  return {
    day: weekdayShort(w.date),
    rest: `${WINDOW_WORDS[w.window].full}, ${monthDay(w.date)}`,
  };
}

export function accessibleWindowName(w: Pick<WindowOut, 'date' | 'window'>): string {
  const { day, rest } = windowNameParts(w);
  return `${day} ${rest}`;
}
