// The /manage re-request date grid's range (seasonOf). It is clamped to the season (settings), the range the
// server's out_of_season check uses. "Today" used to come from
// toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }) and was string-sorted against engine dates, so it
// depended on CLDR keeping en-CA's short date as YYYY-MM-DD. It now comes from Intl's numeric parts in TZ.
// Regression register: evals/bugs/manage-today-from-locale-string.json
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WeekOut } from '@/features/availability/types';
import { seasonOf } from '../_lib/season';

const week = (weekStart: string) => ({ weekStart }) as WeekOut;
/** A season wide enough that the clamp never bites: the engine-and-today range alone. */
const OPEN = { start: '2000-01-01', end: '2099-12-31' };
const SEASON = { start: '2027-04-01', end: '2027-06-30' };
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
  it('with no season clamp, matches the old range wherever en-CA still reads YYYY-MM-DD (every 3 hours, Oct 2026 to Jul 2027)', () => {
    const shapes = [engine(), engine(['2027-04-05', '2027-06-28']), engine(['2027-04-05'], ['2027-07-30'])];
    const diff = instants('2026-10-01T00:00:00Z', '2027-07-31T00:00:00Z', 3 * HOUR).flatMap((now) =>
      shapes
        .filter((e) => {
          // An inverted old range (the engine's last week already past) offered nothing; now it is null.
          const old = before(e, now);
          const want = old.start > old.end ? null : old;
          return JSON.stringify(seasonOf(e, OPEN, now)) !== JSON.stringify(want);
        })
        .map(() => now.toISOString()),
    );
    expect(diff).toEqual([]);
  }, 30_000);

  it("starts on Vancouver's date, not UTC's or the phone's (Apr 1 2027)", () => {
    expect(seasonOf(engine(), OPEN, new Date('2027-04-01T06:59:59Z'))!.start).toBe('2027-03-31');
    expect(seasonOf(engine(), OPEN, new Date('2027-04-01T07:00:00Z'))!.start).toBe('2027-04-01');
  });

  it("doesn't depend on any locale's date wording", () => {
    const now = new Date('2027-04-01T18:00:00Z');
    const want = seasonOf(engine(['2027-04-05']), OPEN, now);
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('4/1/2027'); // CLDR 42's en-CA, briefly
    vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('4/1/2027, 11:00:00 a.m.');
    expect(seasonOf(engine(['2027-04-05']), OPEN, now)).toEqual(want);
    expect(want).toEqual({ start: '2027-04-01', end: '2027-04-11' });
  });

  it('ends on the last week the engine returned, a later off date, or about 4 months out', () => {
    const now = new Date('2027-04-01T18:00:00Z');
    expect(seasonOf(engine(['2027-06-28', '2027-04-05']), OPEN, now)!.end).toBe('2027-07-04');
    expect(seasonOf(engine(['2027-04-05'], ['2027-05-01', '2027-07-30']), OPEN, now)!.end).toBe('2027-07-30');
    expect(seasonOf(engine(), OPEN, now)).toEqual({ start: '2027-04-01', end: '2027-07-30' });
  });

  it('opened before the season: starts on the season start, not today (October shows no dates)', () => {
    const oct = new Date('2026-10-08T18:00:00Z');
    const r = seasonOf(engine(['2027-03-29', '2027-06-28']), SEASON, oct)!;
    expect(r).toEqual({ start: '2027-04-01', end: '2027-06-30' });
    // both halves of the start limit: the day before the season is clamped, the first day is kept
    expect(seasonOf(engine(), SEASON, new Date('2027-03-31T18:00:00Z'))!.start).toBe('2027-04-01');
    expect(seasonOf(engine(), SEASON, new Date('2027-04-01T18:00:00Z'))!.start).toBe('2027-04-01');
  });

  it('inside the season: starts today; the end never passes the season end (last week + 6 is Jul 4)', () => {
    const r = seasonOf(engine(['2027-04-05', '2027-06-28']), SEASON, new Date('2027-05-10T18:00:00Z'))!;
    expect(r).toEqual({ start: '2027-05-10', end: '2027-06-30' });
    // both halves of the end limit: an earlier engine end is kept, a later one (or a later off date) is clamped
    expect(seasonOf(engine(['2027-06-14']), SEASON, new Date('2027-05-10T18:00:00Z'))!.end).toBe(
      '2027-06-20',
    );
    expect(
      seasonOf(engine(['2027-06-14'], ['2027-07-15']), SEASON, new Date('2027-05-10T18:00:00Z'))!.end,
    ).toBe('2027-06-30');
  });

  it('every day it can offer is inside the season, whenever the page is opened (Oct 2026 to Jun 2027)', () => {
    const e = engine(['2027-03-29', '2027-04-05', '2027-06-28'], ['2027-07-02']);
    for (const now of instants('2026-10-01T00:00:00Z', '2027-06-30T12:00:00Z', 24 * HOUR)) {
      const r = seasonOf(e, SEASON, now)!;
      expect(r.start >= SEASON.start && r.end <= SEASON.end && r.start <= r.end, now.toISOString()).toBe(
        true,
      );
    }
  });

  it('after the season (or on its last day + 1): nothing to offer', () => {
    expect(seasonOf(engine(), SEASON, new Date('2027-06-30T18:00:00Z'))).toEqual({
      start: '2027-06-30',
      end: '2027-06-30',
    });
    expect(seasonOf(engine(), SEASON, new Date('2027-07-01T18:00:00Z'))).toBeNull();
  });
});
