// T4.6: the booking page's browser code formats dates without date-fns (src/lib/civil.ts). These tests run the
// date-fns-tz formulas the code used before side by side with the new helpers, so the words on screen stay the same.
// They cover every hour of the season and the year around it, every minute around the DST changes and Vancouver
// midnight on Apr 1 2027, and every civil date from 2026 to 2028. `pnpm test:engine:tz` also runs them in 3 zones.
import { formatInTimeZone } from 'date-fns-tz';
import { describe, expect, it } from 'vitest';
import { flowNotices } from '@/app/book/[dish]/_lib/flow-view';
import { WINDOW_WORDS } from '@/content/ui/booking';
import { dishBySlug, isBookable } from '@/content/menu-helpers';
import type { Dish } from '@/content';
import { windowNameParts } from '@/features/availability/a11y';
import { addCivilDays, civilDateIn } from '@/lib/civil';
import { TZ, vancouverDate, vancouverInstant } from '@/lib/time';

const HOUR = 3_600_000;
const MINUTE = 60_000;

function instants(fromIso: string, toIso: string, stepMs: number): Date[] {
  const out: Date[] = [];
  for (let t = Date.parse(fromIso); t <= Date.parse(toIso); t += stepMs) out.push(new Date(t));
  return out;
}

function civilDates(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = first; d <= last; d = addCivilDays(d, 1)) out.push(d);
  return out;
}

/** Vancouver DST changes in and around the season (2 am local), plus Vancouver midnight on Apr 1 2027. */
const EDGES = [
  '2026-03-08T10:00:00Z', // spring forward 2026
  '2026-11-01T09:00:00Z', // fall back 2026
  '2027-03-14T10:00:00Z', // spring forward 2027
  '2027-11-07T09:00:00Z', // fall back 2027
  '2027-04-01T07:00:00Z', // 2027-04-01 00:00 in Vancouver (PDT), the season's first day
  '2027-07-01T07:00:00Z', // 2027-07-01 00:00 in Vancouver, the day after the season
  '2027-01-01T08:00:00Z', // new year in Vancouver (PST)
];
const EDGE_MINUTES = EDGES.flatMap((iso) => {
  const t = Date.parse(iso);
  return instants(new Date(t - 3 * HOUR).toISOString(), new Date(t + 3 * HOUR).toISOString(), MINUTE);
});
const HOURS = instants('2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z', HOUR);
const ALL_INSTANTS = [...HOURS, ...EDGE_MINUTES];

describe('civilDateIn(instant, TZ) = vancouverDate(instant)', () => {
  it(`agrees on ${ALL_INSTANTS.length} instants: every hour of 2026-2027 and every minute around the edges`, () => {
    const diff = ALL_INSTANTS.filter((t) => civilDateIn(t, TZ) !== vancouverDate(t)).map((t) =>
      t.toISOString(),
    );
    expect(diff).toEqual([]);
  });

  it('turns over at Vancouver midnight, not UTC midnight (Apr 1 2027)', () => {
    expect(civilDateIn(new Date('2027-04-01T06:59:59.999Z'), TZ)).toBe('2027-03-31');
    expect(civilDateIn(new Date('2027-04-01T07:00:00.000Z'), TZ)).toBe('2027-04-01');
    expect(civilDateIn(new Date('2027-04-01T00:00:00.000Z'), TZ)).toBe('2027-03-31');
  });

  it('throws on an invalid date, as date-fns-tz does', () => {
    expect(() => vancouverDate(new Date(NaN))).toThrow(RangeError);
    expect(() => civilDateIn(new Date(NaN), TZ)).toThrow(RangeError);
  });

  it('works for any zone it is given', () => {
    const t = new Date('2027-04-01T03:30:00Z');
    expect(civilDateIn(t, 'UTC')).toBe('2027-04-01');
    expect(civilDateIn(t, 'Asia/Tokyo')).toBe('2027-04-01');
    expect(civilDateIn(t, 'Pacific/Honolulu')).toBe('2027-03-31');
  });
});

describe('flowNotices: "Booking opens <Month d>." is unchanged', () => {
  const before = (opensAt: string) => `Booking opens ${formatInTimeZone(new Date(opensAt), TZ, 'MMMM d')}.`;

  it(`agrees on ${ALL_INSTANTS.length} opening times`, () => {
    const diff = ALL_INSTANTS.map((t) => t.toISOString()).filter(
      (opensAt) => flowNotices({ opensAt }).opensOn !== before(opensAt),
    );
    expect(diff).toEqual([]);
  });

  it('names the Vancouver day around Apr 1 2027', () => {
    expect(flowNotices({ opensAt: '2027-04-01T06:59:00.000Z' }).opensOn).toBe('Booking opens March 31.');
    expect(flowNotices({ opensAt: '2027-04-01T07:00:00.000Z' }).opensOn).toBe('Booking opens April 1.');
  });
});

describe('windowNameParts: the picker tile names are unchanged', () => {
  // The formula before T4.6: noon in Vancouver on the civil date, formatted in Vancouver.
  const before = (date: string, window: keyof typeof WINDOW_WORDS) => {
    const at = vancouverInstant(date, '12:00');
    return {
      day: formatInTimeZone(at, TZ, 'EEE'),
      rest: `${WINDOW_WORDS[window].full}, ${formatInTimeZone(at, TZ, 'MMM d')}`,
    };
  };
  const dates = civilDates('2026-01-01', '2028-12-31');
  const windows = Object.keys(WINDOW_WORDS) as (keyof typeof WINDOW_WORDS)[];

  it(`agrees on ${dates.length} dates x ${windows.length} windows`, () => {
    const diff = dates.flatMap((date) =>
      windows
        .filter(
          (window) =>
            JSON.stringify(windowNameParts({ date, window })) !== JSON.stringify(before(date, window)),
        )
        .map((window) => `${date} ${window}`),
    );
    expect(diff).toEqual([]);
  });

  it('keeps the house names on the DST days and Apr 1 2027', () => {
    expect(windowNameParts({ date: '2027-03-14', window: 'lunch' })).toEqual({
      day: 'Sun',
      rest: 'noon–2 pm, Mar 14',
    });
    expect(windowNameParts({ date: '2027-11-07', window: 'evening' })).toEqual({
      day: 'Sun',
      rest: '7 pm, Nov 7',
    });
    expect(windowNameParts({ date: '2027-04-01', window: 'lunch' })).toEqual({
      day: 'Thu',
      rest: 'noon–2 pm, Apr 1',
    });
  });
});

describe('menu-helpers: a dish leaves the menu after its last Vancouver day, as before', () => {
  const lunch = { ...dishBySlug('the-long-lunch')!, availableUntil: '2027-04-01' } as Dish;
  // The rule before T4.6, on vancouverDate().
  const before = (now: Date) => lunch.bookable && vancouverDate(now) <= lunch.availableUntil!;

  it('agrees every minute around Vancouver midnight after Apr 1 2027', () => {
    const around = instants('2027-04-02T04:00:00Z', '2027-04-02T10:00:00Z', MINUTE);
    expect(
      around.filter((now) => isBookable(lunch, now) !== before(now)).map((t) => t.toISOString()),
    ).toEqual([]);
    expect(isBookable(lunch, new Date('2027-04-02T06:59:59Z'))).toBe(true); // 23:59:59 on Apr 1 in Vancouver
    expect(isBookable(lunch, new Date('2027-04-02T07:00:00Z'))).toBe(false); // 00:00 on Apr 2 in Vancouver
  });
});
