// src/app/_guest/when.ts — the guest screens' time style, as the v1.12 pack draws it (gen.py tile(), G1 #14/#19):
// "Fri May 14 · noon–2 pm" for a lunch, "Fri May 21 · 7 pm" for an evening, "Sat May 8" for a date. Vancouver time.
import { formatInTimeZone } from 'date-fns-tz';
import { TZ, vancouverInstant } from '@/lib/time';

/** "noon", "7 pm", "7:30 pm", "midnight". */
export function clock(instant: Date, withMeridiem = true): string {
  const h = Number(formatInTimeZone(instant, TZ, 'H'));
  const m = formatInTimeZone(instant, TZ, 'mm');
  if (m === '00' && h === 12) return 'noon';
  if (m === '00' && h === 0) return 'midnight';
  const base = formatInTimeZone(instant, TZ, m === '00' ? 'h' : 'h:mm');
  return withMeridiem ? `${base} ${h < 12 ? 'am' : 'pm'}` : base;
}

/** "noon–2 pm", "10–11:30 am", "11 am–1 pm". The start drops its am/pm when both ends share it. */
export function clockRange(start: Date, end: Date): string {
  const sameHalf =
    Number(formatInTimeZone(start, TZ, 'H')) < 12 === Number(formatInTimeZone(end, TZ, 'H')) < 12;
  const a = clock(start, !sameHalf);
  return `${a}–${clock(end)}`;
}

export const dayOf = (instant: Date): string => formatInTimeZone(instant, TZ, 'EEE MMM d');

/** A picked or offered time: lunches show their range, evenings their start (as the pack's tiles do). */
export function slotLabel(start: Date, end: Date, windowKind: 'lunch' | 'evening' | null): string {
  return `${dayOf(start)} · ${windowKind === 'evening' ? clock(start) : clockRange(start, end)}`;
}

/** A picked date ('2027-05-08') → "Sat May 8". */
export const dateLabel = (date: string): string => dayOf(vancouverInstant(date, '12:00'));
