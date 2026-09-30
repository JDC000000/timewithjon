// src/app/admin/_requests/lock-sheet.ts — T2.3.U1: the dates-mode Lock sheet's rules without React: a dish's
// Start/Length defaults (Q8, Jon decisions), reading "10:30 am" typed into Other…, what the lock counts toward
// (C3 rule 5: a dish's own rule; for a pitch Jon picks, a day out defaulting to a Big Day) and the commit words.
import { LOCK_DEFAULTS, LOCK_SHEET } from '@/content/ui/admin-requests';
import { dishBySlug } from '@/content/menu-helpers';
import type { CountsToward } from '@/features/availability/types';
import { dayLabel, vancouverInstant } from '@/lib/time';
import { clockLabel } from './format';

export function defaultsFor(dish: string): { start: string; minutes: number } {
  return LOCK_DEFAULTS.byDish[dish] ?? LOCK_DEFAULTS.fallback;
}

/** The Start options: the fixed three plus the dish's default, in clock order. */
export function startOptions(dish: string): string[] {
  return [...new Set([...LOCK_DEFAULTS.starts, defaultsFor(dish).start])].sort();
}

/** "10:30 am", "10:30am", "7 pm", "noon", "19:15" -> "HH:mm"; null if it isn't a time. */
export function parseClock(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/\./g, '');
  if (v === 'noon') return '12:00';
  if (v === 'midnight') return '00:00';
  const m = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/.exec(v);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ?? '00';
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
  } else if (h > 23 || (m[2] === undefined && h < 13 && h !== 0)) {
    return null; // "7" alone is ambiguous; "19" or "7:30" (24 h) is fine
  }
  return `${String(h).padStart(2, '0')}:${min}`;
}

/** What the lock counts toward: the dish's dates rule; a pitch (jon_sets) defaults to a Big Day for half a day+. */
export function defaultCountsToward(dish: string, minutes: number): CountsToward {
  const d = dishBySlug(dish);
  const rule = d?.datesCountToward ?? d?.countsToward ?? 'weekly_cap';
  if (rule !== 'jon_sets') return rule;
  return minutes >= LOCK_DEFAULTS.pitchBigDayMinutes ? 'big_day' : 'weekly_cap';
}

export function lengthWords(minutes: number): string {
  return LOCK_DEFAULTS.lengths.find((l) => l.minutes === minutes)?.words ?? `${minutes} min`;
}

/** "Lock in Sat May 8, 9 am". */
export function commitLabel(date: string, start: string): string {
  const at = vancouverInstant(date, start);
  return LOCK_SHEET.lockIn(dayLabel(at), clockLabel(at));
}
