// S7 month grid model (T1.6.U1, pack gen.py cal_month() + site.js "Date grid"): Monday-first months over the season,
// days off for the engine's unavailableDates (C3 rule 11) or the dish's date rule, two dates max (a third swaps
// out the oldest), and the roving-tabindex moves. Pure; DateGrid renders it and DatesFlow holds the state.
import type { DateRule } from '@/content';
import { addCivilDays, longDate, monthName, parseCivil, shortDate } from '@/lib/civil';

/** Why a day can't be picked: the engine said so, or the dish's date rule (Old Haunt weekends, Big Days). */
export type DayOff = 'unavailable' | 'rule' | null;

export interface CalDay {
  date: string;
  day: number;
  /** "Saturday May 8" */
  long: string;
  /** "Sat May 8" */
  short: string;
  off: DayOff;
}

export interface CalMonth {
  /** "2027-05" */
  key: string;
  /** "May 2027" */
  name: string;
  /** Rows of 7 (Monday first); null pads the first and last rows. */
  rows: (CalDay | null)[][];
}

export const MAX_DATES = 2;

/** Whether a date passes the dish's rule (validate.ts is the server side of the same rule). */
export function ruleAllows(rule: DateRule | null, date: string): boolean {
  const dow = parseCivil(date).weekday;
  if (rule === 'weekend') return dow >= 6;
  if (rule === 'weekend-or-thu-fri') return dow >= 4;
  return true;
}

export function calMonths(
  season: { start: string; end: string },
  unavailable: readonly string[],
  rule: DateRule | null,
): CalMonth[] {
  const off = new Set(unavailable);
  const months: CalMonth[] = [];
  for (let d = season.start; d <= season.end; d = addCivilDays(d, 1)) {
    const key = d.slice(0, 7);
    let m = months.at(-1);
    if (!m || m.key !== key) {
      m = { key, name: `${monthName(d)} ${parseCivil(d).year}`, rows: [[]] };
      months.push(m);
      // Pad from Monday (the first day may be the season start, not the 1st: the grid still starts on the 1st).
      const first = `${key}-01`;
      for (let i = 1; i < parseCivil(first).weekday; i++) m.rows[0]!.push(null);
      for (let p = first; p < d; p = addCivilDays(p, 1)) pushDay(m, day(p, 'unavailable'));
    }
    pushDay(m, day(d, off.has(d) ? 'unavailable' : ruleAllows(rule, d) ? null : 'rule'));
  }
  for (const m of months) {
    const last = m.rows.at(-1)!;
    // The season may end mid-month: the rest of the month shows, off.
    const lastDay = [...last].reverse().find((c) => c !== null);
    let p = addCivilDays(lastDay?.date ?? `${m.key}-01`, 1);
    while (p.startsWith(m.key)) {
      pushDay(m, day(p, 'unavailable'));
      p = addCivilDays(p, 1);
    }
    const tail = m.rows.at(-1)!;
    if (tail.length === 0) m.rows.pop();
    else while (tail.length < 7) tail.push(null);
  }
  return months;
}

function day(date: string, off: DayOff): CalDay {
  return { date, day: parseCivil(date).day, long: longDate(date), short: shortDate(date), off };
}

function pushDay(m: CalMonth, d: CalDay) {
  let row = m.rows.at(-1)!;
  if (row.length === 7) m.rows.push((row = []));
  row.push(d);
}

export const monthDays = (m: CalMonth): CalDay[] => m.rows.flat().filter((c): c is CalDay => c !== null);
export const allDays = (months: readonly CalMonth[]): CalDay[] => months.flatMap(monthDays);
export const monthOf = (months: readonly CalMonth[], date: string) =>
  months.find((m) => date.startsWith(m.key));

/** Tap a day: un-pick it, or pick it (a third pick swaps out the oldest). Returns the new order and the swap. */
export function toggleDate(
  order: readonly string[],
  date: string,
): { order: string[]; swapped: string | null } {
  if (order.includes(date)) return { order: order.filter((d) => d !== date), swapped: null };
  const swapped = order.length >= MAX_DATES ? order[0]! : null;
  return { order: [...order.slice(swapped ? 1 : 0), date], swapped };
}

/**
 * The next pickable day from `from` for a key (site.js move(), plus the APG Home/End and PageUp/PageDown): arrows
 * move by a day or a week and step over days that are off (a day at a time, the way the key points); null at the
 * season's edge.
 */
export function stepDay(days: readonly CalDay[], from: string, key: string): string | null {
  const i = days.findIndex((d) => d.date === from);
  if (i < 0) return null;
  const at = parseCivil(from);
  let j: number;
  let dir: 1 | -1;
  switch (key) {
    case 'ArrowRight':
      [j, dir] = [i + 1, 1];
      break;
    case 'ArrowLeft':
      [j, dir] = [i - 1, -1];
      break;
    case 'ArrowDown':
      [j, dir] = [i + 7, 1];
      break;
    case 'ArrowUp':
      [j, dir] = [i - 7, -1];
      break;
    case 'Home':
      [j, dir] = [i - (at.weekday - 1), 1];
      break;
    case 'End':
      [j, dir] = [i + (7 - at.weekday), -1];
      break;
    case 'PageDown':
    case 'PageUp': {
      const target = shiftMonth(from, key === 'PageDown' ? 1 : -1);
      j = days.findIndex((d) => d.date === target);
      if (j < 0) return null;
      dir = key === 'PageDown' ? 1 : -1;
      break;
    }
    default:
      return null;
  }
  if (key === 'Home' || key === 'End') j = Math.max(0, Math.min(days.length - 1, j));
  while (j >= 0 && j < days.length && days[j]!.off) j += dir;
  const t = days[j];
  return t && t.date !== from ? t.date : null;
}

/** The same day in the next/previous month, clamped to the month's last day (Jan 31 + 1 -> Feb 28). */
function shiftMonth(date: string, by: 1 | -1): string {
  const { year, month, day: dd } = parseCivil(date);
  const m0 = month - 1 + by;
  const y = year + Math.floor(m0 / 12);
  const m = ((m0 % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`;
}

/**
 * The one Tab stop, always in the month shown (phones hide the others): the last day moved to or tapped there,
 * else its oldest pick, else its first pickable day; a month with none falls back to the season's first.
 */
export function tabStopDay(
  months: readonly CalMonth[],
  order: readonly string[],
  shown: string,
  active: string | null = null,
): string | null {
  const m = months.find((x) => x.key === shown);
  const open = m ? monthDays(m).filter((d) => !d.off) : [];
  const has = (d: string | null | undefined) => d != null && open.some((x) => x.date === d);
  if (has(active)) return active;
  return order.find(has) ?? open[0]?.date ?? allDays(months).find((d) => !d.off)?.date ?? null;
}

/** The month shown first on phones: the oldest pick's, else the first with a pickable day. */
export function initialCalMonth(months: readonly CalMonth[], order: readonly string[]): string {
  const picked = order[0] && monthOf(months, order[0]);
  if (picked) return picked.key;
  return (months.find((m) => monthDays(m).some((d) => !d.off)) ?? months[0])?.key ?? '';
}
