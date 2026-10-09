// src/content/types.ts — AD-10 typed content. Every word here is Jon's or the copywriter's.
import type { CountsToward, WindowKind } from '@/features/availability/types';

export type Section = 'starters' | 'mains' | 'big-days' | 'off-the-menu';
export type DishSlug =
  | 'the-flat-white'
  | 'the-first-round'
  | 'the-long-distance'
  | 'the-long-lunch'
  | 'the-old-haunt'
  | 'the-encore'
  | 'the-double-date'
  | 'the-family-hang'
  | 'the-shore-ride'
  | 'catch-and-release'
  | 'the-grind'
  | 'the-day-trip'
  | 'surprise-me'
  | 'pitch-me'
  | 'something-new';
/** Which screen flow the Book button opens (C3 rule 5). */
export type Flow = 'picker' | 'dates' | 'surprise' | 'pitch' | 'old-haunt';
/** Which dates a dates-mode request may pick. */
export type DateRule = 'any-day' | 'weekend-or-thu-fri' | 'weekend';

export interface Dish {
  slug: DishSlug;
  section: Section;
  name: string;
  /** The name inside a sentence ("I was thinking …", "Book …", emails' {dish}); absent = `name`. */
  inSentence?: string;
  line: string;
  detail: string;
  mode: 'slots' | 'dates' | 'slots-or-dates';
  flow: Flow;
  windows: WindowKind[]; // slots-mode windows (C3 rule 2(i)); [] for dates-only dishes
  countsToward: CountsToward | 'jon_sets'; // slots/dates default; Old Haunt weekend = big_day
  datesCountToward?: CountsToward; // for slots-or-dates dishes, when booked by date
  dateRule?: DateRule;
  overnightAllowed: boolean;
  servesMax: number;
  /** The smallest party, the guest included; absent = 1. Equal to servesMax = a fixed size (the menu says "serves N"). */
  servesMin?: number;
  bookable: boolean;
  availableUntil: string | null; // Vancouver civil date; hidden after it
  /** At most this many locked/done bookings of this dish start in one week (canLock; Override this week lifts it). */
  maxPerWeek?: number;
  suggestions?: string[];
  /** Pitch Me: the line before the examples ("You choose."); prose, not a tap-to-add starter. */
  suggestionsLead?: string;
}
