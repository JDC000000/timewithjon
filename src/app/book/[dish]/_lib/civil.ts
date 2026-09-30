// Civil-date formatting for the booking screens. Dates are Vancouver civil dates ('2027-05-06') from the engine;
// they are formatted as calendar dates (no instant, no time zone), so the result never depends on the browser's zone.

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
}

export function parseCivil(date: string): CivilDate {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return { year, month, day, weekday: ((utc.getUTCDay() + 6) % 7) + 1 };
}

export function addCivilDays(date: string, days: number): string {
  const { year, month, day } = parseCivil(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export const monthName = (date: string): string => MONTHS[parseCivil(date).month - 1] ?? '';
export const monthShort = (date: string) => monthName(date).slice(0, 3);
export const weekdayName = (date: string): string => WEEKDAYS[parseCivil(date).weekday - 1] ?? '';
export const weekdayShort = (date: string) => weekdayName(date).slice(0, 3);

/** "May 6" */
export function monthDay(date: string): string {
  return `${monthShort(date)} ${parseCivil(date).day}`;
}
/** "Thu May 6" */
export function shortDate(date: string): string {
  return `${weekdayShort(date)} ${monthDay(date)}`;
}
/** "Thursday May 6" */
export function longDate(date: string): string {
  return `${weekdayName(date)} ${monthName(date)} ${parseCivil(date).day}`;
}
/** "Apr 1–2" within one month, "Apr 29–May 1" across two. */
export function dayRange(first: string, last: string): string {
  if (first === last) return monthDay(first);
  return monthShort(first) === monthShort(last)
    ? `${monthDay(first)}–${parseCivil(last).day}`
    : `${monthDay(first)}–${monthDay(last)}`;
}
