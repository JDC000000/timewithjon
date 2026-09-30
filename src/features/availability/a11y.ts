// src/features/availability/a11y.ts — T1.5 AC5: a time tile's accessible name is the pack v1.12 one (VD6-09):
// "Thu noon–2 pm, May 6" / "Fri 7 pm, May 7". Selection is spoken by aria-pressed, never by the name.
// ONE source for the picker tiles (src/app/book), the pack and the E2E selectors.
import { formatInTimeZone } from 'date-fns-tz';
import { TZ, vancouverInstant } from '@/lib/time';
import type { WindowOut } from '@/features/availability/types';
import { WINDOW_WORDS } from '@/content/ui/booking';

export interface WindowNameParts {
  /** The visible weekday, "Thu". */
  day: string;
  /** The rest, spoken whole: "noon–2 pm, May 6". */
  rest: string;
}

export function windowNameParts(w: Pick<WindowOut, 'date' | 'window'>): WindowNameParts {
  const at = vancouverInstant(w.date, '12:00');
  return {
    day: formatInTimeZone(at, TZ, 'EEE'),
    rest: `${WINDOW_WORDS[w.window].full}, ${formatInTimeZone(at, TZ, 'MMM d')}`,
  };
}

export function accessibleWindowName(w: Pick<WindowOut, 'date' | 'window'>): string {
  const { day, rest } = windowNameParts(w);
  return `${day} ${rest}`;
}
