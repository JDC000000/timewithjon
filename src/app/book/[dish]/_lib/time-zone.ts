// The Long Distance "Your time zone" (T1.6.U2, wireframe 05-C): set from the phone, editable, posted as
// guestTimeZone. The drawn list covers most guests; "Somewhere else" keeps whatever zone the phone reports.
import { TIME_ZONE } from '@/content/ui/booking';

export const ELSEWHERE = 'elsewhere';
const LISTED = new Set(TIME_ZONE.options.map((o) => o.value));

/** A value the select can hold (a kept draft's zone is checked with this, QA M3). */
export const isZoneOption = (v: string) => v === ELSEWHERE || LISTED.has(v);

/** Zones the list draws under another name (Calgary's zone is Edmonton's; Berlin shares Paris's option). */
const ALIASES: Readonly<Record<string, string>> = {
  'America/Calgary': 'America/Edmonton',
  'Europe/Berlin': 'Europe/Paris',
};

/** The option the select starts on: the phone's zone if listed, else "Somewhere else"; Vancouver before hydration. */
export function initialZoneOption(detected: string | null): string {
  if (!detected) return TIME_ZONE.options[0]!.value;
  const z = ALIASES[detected] ?? detected;
  return LISTED.has(z) ? z : ELSEWHERE;
}

/** What goes in guestTimeZone: a listed zone as chosen; "Somewhere else" sends the phone's zone, or nothing. */
export function postedZone(option: string, detected: string | null): string | undefined {
  if (option !== ELSEWHERE) return option;
  return detected ?? undefined;
}
