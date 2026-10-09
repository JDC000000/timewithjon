// src/app/admin/_requests/format.ts — how A2/A3 write times and waits, in the house style of the v1.12 pack
// (g1 #3 (a): a 12-hour clock, "Fri May 14 · noon–2 pm", "Fri Apr 16 · 7 pm", "3 h", "1 d"). Vancouver time only
// (AD-2); every instant goes through src/lib/time.ts's zone.
import { formatInTimeZone } from 'date-fns-tz';
import { TIME_ZONE } from '@/content/ui/booking';
import { TZ } from '@/lib/time';

// The clock, range and day-and-time labels live in src/lib/when.ts since QA C (the guest emails and pages use them
// too); re-exported here for the admin screens.
export { clockLabel, rangeLabel, whenLabel } from '@/lib/when';

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

/** QA4 L3: a guest's zone as the booking form names it ("St. John’s (Newfoundland)"); any other zone as its id. */
export function zoneLabel(zone: string): string {
  return TIME_ZONE.options.find((o) => o.value === zone)?.label ?? zone.replace(/_/g, ' ');
}
