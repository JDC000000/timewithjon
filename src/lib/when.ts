// src/lib/when.ts — the house time style (v1.12 pack g1 #3 (a), the S6 picker's tiles): a 12-hour clock, "Fri May 14 ·
// noon–2 pm" for a lunch, "Fri Apr 16 · 7 pm" for an evening (its start), "Sat Apr 3 · 9 am–1 pm" for any other range.
// One formatter for the admin screens and for every time a guest reads (emails, /manage, /offer: QA C), so the
// emails say what the site says. Vancouver time (AD-2); guestWhen() always says so and adds the guest's clock when it differs.
import { formatInTimeZone } from 'date-fns-tz';
import { TZ } from './time';

/** "noon", "7 pm", "10:30 am", "midnight". */
export function clockLabel(instant: Date, zone: string = TZ): string {
  const hm = formatInTimeZone(instant, zone, 'HH:mm');
  if (hm === '12:00') return 'noon';
  if (hm === '00:00') return 'midnight';
  const mins = hm.endsWith(':00') ? 'h' : 'h:mm';
  return formatInTimeZone(instant, zone, `${mins} aaa`);
}

/**
 * The time part of a window or a locked range: a lunch is "noon–2 pm", an evening is its start ("7 pm"), any other
 * range is "start–end" ("9–11 am", "10:30 am–1 pm"). A range longer than a day's clock can say is left to its start.
 */
export function rangeLabel(start: Date, end: Date, zone: string = TZ): string {
  const s = formatInTimeZone(start, zone, 'HH:mm');
  const e = formatInTimeZone(end, zone, 'HH:mm');
  if (s === '12:00' && e === '14:00') return 'noon–2 pm';
  if (s === '19:00' && e === '22:00') return '7 pm';
  if (end.getTime() - start.getTime() >= 12 * 3_600_000) return clockLabel(start, zone);
  const from = clockLabel(start, zone);
  const to = clockLabel(end, zone);
  const sameHalf =
    !['noon', 'midnight'].includes(from) &&
    !['noon', 'midnight'].includes(to) &&
    from.slice(-2) === to.slice(-2);
  return sameHalf ? `${from.slice(0, -3)}–${to}` : `${from}–${to}`;
}

const dayIn = (instant: Date, zone: string) => formatInTimeZone(instant, zone, 'EEE MMM d');

/** "Fri May 14 · noon–2 pm", Vancouver time. */
export function whenLabel(start: Date, end: Date): string {
  return `${dayIn(start, TZ)} · ${rangeLabel(start, end)}`;
}

function knownZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    formatInTimeZone(new Date(0), zone, 'HH');
    return zone;
  } catch {
    return null;
  }
}

/**
 * A time as a guest reads it (QA C; TSD C5 M2, EML-01): whenLabel() and "Vancouver time", always, so a guest with no
 * zone (every slot dish) or out of town still knows whose clock it is: "Fri May 14 · noon–2 pm Vancouver time". A
 * guest whose zone shows another clock gets theirs after it, "(3–5 pm your time)", with their day too when it
 * differs. An evening stays its start in their zone as well.
 */
export function guestWhen(start: Date, end: Date, guestTimeZone: string | null | undefined): string {
  const ours = `${whenLabel(start, end)} Vancouver time`;
  const zone = knownZone(guestTimeZone);
  if (!zone || zone === TZ) return ours;
  const startOnly = !rangeLabel(start, end).includes('–');
  const time = startOnly ? clockLabel(start, zone) : rangeLabel(start, end, zone);
  const day = dayIn(start, zone);
  if (`${day} · ${time}` === whenLabel(start, end)) return ours;
  return `${ours} (${day === dayIn(start, TZ) ? time : `${day} · ${time}`} your time)`;
}
