// src/app/admin/_requests/format.ts — how A2/A3 write times and waits, in the house style of the v1.12 pack
// (g1 #3 (a): a 12-hour clock, "Fri May 14 · noon–2 pm", "Fri Apr 16 · 7 pm", "3 h", "1 d"). Vancouver time only
// (AD-2); every instant goes through src/lib/time.ts's zone.
import { formatInTimeZone } from 'date-fns-tz';
import { dayLabel, TZ } from '@/lib/time';

/** "noon", "7 pm", "10:30 am", "midnight". */
export function clockLabel(instant: Date): string {
  const hm = formatInTimeZone(instant, TZ, 'HH:mm');
  if (hm === '12:00') return 'noon';
  if (hm === '00:00') return 'midnight';
  const mins = hm.endsWith(':00') ? 'h' : 'h:mm';
  return formatInTimeZone(instant, TZ, `${mins} aaa`);
}

function hm(instant: Date): string {
  return formatInTimeZone(instant, TZ, 'HH:mm');
}

/**
 * The time part of a window or a locked range: a lunch is "noon–2 pm", an evening is its start ("7 pm"), any other
 * range is "start–end" ("9–11 am", "10:30 am–1 pm"). A range longer than a day's clock can say is left to its start.
 */
export function rangeLabel(start: Date, end: Date): string {
  const s = hm(start);
  const e = hm(end);
  if (s === '12:00' && e === '14:00') return 'noon–2 pm';
  if (s === '19:00' && e === '22:00') return '7 pm';
  if (end.getTime() - start.getTime() >= 12 * 3_600_000) return clockLabel(start);
  const from = clockLabel(start);
  const to = clockLabel(end);
  const sameHalf =
    !['noon', 'midnight'].includes(from) &&
    !['noon', 'midnight'].includes(to) &&
    from.slice(-2) === to.slice(-2);
  return sameHalf ? `${from.slice(0, -3)}–${to}` : `${from}–${to}`;
}

/** "Fri May 14 · noon–2 pm". */
export function whenLabel(start: Date, end: Date): string {
  return `${dayLabel(start)} · ${rangeLabel(start, end)}`;
}

/** A wait, as the inbox rows show it: minutes under an hour, hours under two days, then days. */
export function ageLabel(since: Date, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** "Apr 8": a locked row's date, or the day a request was cancelled. */
export function shortDate(instant: Date): string {
  return formatInTimeZone(instant, TZ, 'MMM d');
}
