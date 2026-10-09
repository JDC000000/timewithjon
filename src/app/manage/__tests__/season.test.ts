// The /manage re-request date grid's range (seasonOf). "Today" used to come from
// toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }) and was string-sorted against engine dates, so it
// depended on CLDR keeping en-CA's short date as YYYY-MM-DD. It now comes from Intl's numeric parts in TZ.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WeekOut } from '@/features/availability/types';
import { seasonOf } from '../_lib/season';

const week = (weekStart: string) => ({ weekStart }) as WeekOut;
const engine = (weekStarts: string[] = [], unavailableDates: string[] = []) => ({
  weeks: weekStarts.map(week),
  unavailableDates,
});

/** The formula before: the browser's en-CA date string and a UTC-noon day step. */
function before(e: ReturnType<typeof engine>, now: Date) {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
  const addDays = (date: string, n: number) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const last = e.weeks
    .map((w) => w.weekStart)
    .sort()
    .at(-1);
  const end = last ? addDays(last, 6) : addDays(today, 120);
  return { start: today, end: [...e.unavailableDates, end].sort().at(-1)! };
}

const HOUR = 3_600_000;
function instants(from: string, to: string, step: number): Date[] {
  const out: Date[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += step) out.push(new Date(t));
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe('seasonOf (the /manage re-request date grid)', () => {
  it('matches the old range wherever en-CA still reads YYYY-MM-DD (every 3 hours, Oct 2026 to Jul 2027)', () => {
    const shapes = [engine(), engine(['2027-04-05', '2027-06-28']), engine(['2027-04-05'], ['2027-07-30'])];
    const diff = instants('2026-10-01T00:00:00Z', '2027-07-31T00:00:00Z', 3 * HOUR).flatMap((now) =>
      shapes
        .filter((e) => JSON.stringify(seasonOf(e, now)) !== JSON.stringify(before(e, now)))
        .map(() => now.toISOString()),
    );
    expect(diff).toEqual([]);
  }, 30_000);

  it("starts on Vancouver's date, not UTC's or the phone's (Apr 1 2027)", () => {
    expect(seasonOf(engine(), new Date('2027-04-01T06:59:59Z')).start).toBe('2027-03-31');
    expect(seasonOf(engine(), new Date('2027-04-01T07:00:00Z')).start).toBe('2027-04-01');
  });

  it("doesn't depend on any locale's date wording", () => {
    const now = new Date('2027-04-01T18:00:00Z');
    const want = seasonOf(engine(['2027-04-05']), now);
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('4/1/2027'); // CLDR 42's en-CA, briefly
    vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('4/1/2027, 11:00:00 a.m.');
    expect(seasonOf(engine(['2027-04-05']), now)).toEqual(want);
    expect(want).toEqual({ start: '2027-04-01', end: '2027-04-11' });
  });

  it('ends on the last week the engine returned, a later off date, or about 4 months out', () => {
    const now = new Date('2027-04-01T18:00:00Z');
    expect(seasonOf(engine(['2027-06-28', '2027-04-05']), now).end).toBe('2027-07-04');
    expect(seasonOf(engine(['2027-04-05'], ['2027-05-01', '2027-07-30']), now).end).toBe('2027-07-30');
    expect(seasonOf(engine(), now)).toEqual({ start: '2027-04-01', end: '2027-07-30' });
  });
});
