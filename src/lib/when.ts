// src/lib/when.ts — the house time style (v1.12 pack g1 #3 (a), the S6 picker's tiles): a 12-hour clock, "Fri May 14 ·
// noon–2 pm" for a lunch, "Fri Apr 16 · 7 pm" for an evening (its start), "Sat Apr 3 · 9 am–1 pm" for any other range,
// "Thu Jun 24 · 3 pm to Fri 11 am" for one that runs into another day (Q11).
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
 * The time part of a window or a locked range on one day: a lunch is "noon–2 pm", an evening is its start ("7 pm"),
 * any other range is "start–end" ("9–11 am", "10:30 am–1 pm", "8 am–9 pm").
 */
export function rangeLabel(start: Date, end: Date, zone: string = TZ): string {
  const s = formatInTimeZone(start, zone, 'HH:mm');
  const e = formatInTimeZone(end, zone, 'HH:mm');
  if (s === '12:00' && e === '14:00') return 'noon–2 pm';
  if (s === '19:00' && e === '22:00') return '7 pm';
  const from = clockLabel(start, zone);
  const to = clockLabel(end, zone);
  const sameHalf =
    !['noon', 'midnight'].includes(from) &&
    !['noon', 'midnight'].includes(to) &&
    from.slice(-2) === to.slice(-2);
  return sameHalf ? `${from.slice(0, -3)}–${to}` : `${from}–${to}`;
}

const dayIn = (instant: Date, zone: string) => formatInTimeZone(instant, zone, 'EEE MMM d');
const DAY_MS = 24 * 3_600_000;

/**
 * Everything after "Fri May 14 · ": rangeLabel() for a range within one day, and for one that runs into another day
 * (overnight, a day-long booking) its start AND end, Q11 (approved: Jon 2026-10-09): "3 pm to Fri 11 am" (the end's
 * weekday within the week, its date beyond).
 */
function timePart(start: Date, end: Date, zone: string): string {
  if (dayIn(start, zone) === dayIn(new Date(end.getTime() - 1), zone)) return rangeLabel(start, end, zone);
  const endDay = formatInTimeZone(
    end,
    zone,
    end.getTime() - start.getTime() < 6 * DAY_MS ? 'EEE' : 'EEE MMM d',
  );
  return `${clockLabel(start, zone)} to ${endDay} ${clockLabel(end, zone)}`;
}

/** "Fri May 14 · noon–2 pm", "Thu Jun 24 · 3 pm to Fri 11 am", Vancouver time. */
export function whenLabel(start: Date, end: Date): string {
  return `${dayIn(start, TZ)} · ${timePart(start, end, TZ)}`;
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
  const startOnly = timePart(start, end, TZ) === clockLabel(start, TZ); // an evening is its start
  const time = startOnly ? clockLabel(start, zone) : timePart(start, end, zone);
  const day = dayIn(start, zone);
  if (`${day} · ${time}` === whenLabel(start, end)) return ours;
  return `${ours} (${day === dayIn(start, TZ) ? time : `${day} · ${time}`} your time)`;
}

/**
 * One moment as a guest reads it (Q4, E7's "It’s yours until …"): "Sat Apr 3 · 9 am Vancouver time", and the guest's
 * own clock after it when their zone shows another one.
 */
export function guestAt(at: Date, guestTimeZone: string | null | undefined): string {
  const ours = `${dayIn(at, TZ)} · ${clockLabel(at, TZ)}`;
  const zone = knownZone(guestTimeZone);
  if (!zone || zone === TZ) return `${ours} Vancouver time`;
  const theirs = `${dayIn(at, zone)} · ${clockLabel(at, zone)}`;
  if (theirs === ours) return `${ours} Vancouver time`;
  const time = dayIn(at, zone) === dayIn(at, TZ) ? clockLabel(at, zone) : theirs;
  return `${ours} Vancouver time (${time} your time)`;
}
