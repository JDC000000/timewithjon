// src/lib/time.ts — the server's time helpers (AD-2: date-fns-tz, America/Vancouver). Browser code uses the
// date-fns-free helpers in src/lib/civil.ts instead (T4.6: no date-fns in the guest pages' scripts).
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { TZ } from './tz';

export { TZ };

/** Civil date (YYYY-MM-DD) of an instant, in Vancouver. Never use toISOString().slice(0,10). */
export function vancouverDate(instant: Date): string {
  return formatInTimeZone(instant, TZ, 'yyyy-MM-dd');
}

/** Vancouver wall-clock 'YYYY-MM-DD' + 'HH:mm' -> UTC instant. */
export function vancouverInstant(date: string, time: string): Date {
  return fromZonedTime(`${date}T${time}:00`, TZ);
}

/** Like vancouverInstant, but null for a date or wall-clock time that doesn't exist (the spring-forward gap). */
export function vancouverInstantOrNull(date: string, time: string): Date | null {
  const instant = vancouverInstant(date, time);
  if (Number.isNaN(instant.getTime())) return null;
  return formatInTimeZone(instant, TZ, 'yyyy-MM-dd HH:mm') === `${date} ${time}` ? instant : null;
}

/** Pure civil-date arithmetic (TZ-independent: uses UTC fields only). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** ISO weekday of a civil date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return dow === 0 ? 7 : dow;
}

/** Monday (YYYY-MM-DD) of the Mon–Sun week containing a civil date (C3 rule 1). */
export function weekStartOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** Every civil date touched by [start, end). end is exclusive. */
export function datesTouched(start: Date, end: Date): string[] {
  const first = vancouverDate(start);
  const last = vancouverDate(new Date(end.getTime() - 1));
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Vancouver day label for emails and events, e.g. "Thu May 13". */
export function dayLabel(instant: Date): string {
  return formatInTimeZone(instant, TZ, 'EEE MMM d');
}

/**
 * The engine's machine label for a window start, 24-hour ("Thu May 13, 12:00", AC13). Never shown to a guest or
 * Jon: words they read use whenLabel() / guestWhen() from '@/lib/when' (the 12-hour house style).
 */
export function windowLabel(instant: Date): string {
  return formatInTimeZone(instant, TZ, 'EEE MMM d, HH:mm');
}

/** Vancouver wall-clock time of an instant, e.g. '5:05 PM' (the email-limit banner, T3.2.07). */
export function vancouverClock(instant: Date): string {
  return formatInTimeZone(instant, TZ, 'h:mm a');
}
