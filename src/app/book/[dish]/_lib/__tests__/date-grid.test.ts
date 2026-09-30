// T1.6.U1 month grid model (pack s07): the months, the off days, two dates max and the roving moves.
import { describe, expect, it } from 'vitest';
import {
  allDays,
  calMonths,
  initialCalMonth,
  monthDays,
  ruleAllows,
  stepDay,
  tabStopDay,
  toggleDate,
} from '../date-grid';

const SEASON = { start: '2027-04-01', end: '2027-06-30' };
// The pack's away range (Apr 24 - May 3).
const AWAY = Array.from({ length: 10 }, (_, i) =>
  new Date(Date.UTC(2027, 3, 24 + i)).toISOString().slice(0, 10),
);

describe('calMonths', () => {
  const months = calMonths(SEASON, AWAY, null);

  it('one month per season month, Monday first, padded to whole weeks', () => {
    expect(months.map((m) => [m.key, m.name])).toEqual([
      ['2027-04', 'April 2027'],
      ['2027-05', 'May 2027'],
      ['2027-06', 'June 2027'],
    ]);
    // Apr 1 2027 is a Thursday: three pads, then the 1st.
    expect(months[0]!.rows[0]!.slice(0, 4).map((c) => c?.day ?? null)).toEqual([null, null, null, 1]);
    for (const m of months) for (const r of m.rows) expect(r).toHaveLength(7);
    expect(monthDays(months[1]!)).toHaveLength(31);
    expect(months[1]!.rows.at(-1)!.filter(Boolean)).toHaveLength(1); // May 31 is a Monday
  });

  it('names a day the pack way', () => {
    const d = allDays(months).find((x) => x.date === '2027-05-08')!;
    expect([d.day, d.long, d.short]).toEqual([8, 'Saturday May 8', 'Sat May 8']);
  });

  it('marks unavailable dates, and only them, with no rule', () => {
    const off = allDays(months).filter((d) => d.off);
    expect(off.map((d) => d.date)).toEqual(AWAY);
    expect(off.every((d) => d.off === 'unavailable')).toBe(true);
  });

  it('a date rule marks the other days "rule" (unavailable wins)', () => {
    const wk = allDays(calMonths(SEASON, AWAY, 'weekend'));
    expect(wk.find((d) => d.date === '2027-05-06')!.off).toBe('rule'); // Thu
    expect(wk.find((d) => d.date === '2027-05-08')!.off).toBeNull(); // Sat
    expect(wk.find((d) => d.date === '2027-05-01')!.off).toBe('unavailable'); // Sat, away
    expect(wk.find((d) => d.date === '2027-04-29')!.off).toBe('unavailable'); // Thu, away: struck, not "weekends only"
    const big = allDays(calMonths(SEASON, [], 'weekend-or-thu-fri'));
    expect(big.find((d) => d.date === '2027-05-05')!.off).toBe('rule'); // Wed
    expect(big.find((d) => d.date === '2027-05-06')!.off).toBeNull(); // Thu
  });

  it('a season that starts or ends mid-month shows whole months, the outside days off', () => {
    const mid = calMonths({ start: '2027-04-10', end: '2027-05-20' }, [], null);
    expect(mid.map((m) => m.key)).toEqual(['2027-04', '2027-05']);
    const days = allDays(mid);
    expect(days[0]!.date).toBe('2027-04-01');
    expect(days.at(-1)!.date).toBe('2027-05-31');
    expect(days.filter((d) => !d.off)[0]!.date).toBe('2027-04-10');
    expect(days.filter((d) => !d.off).at(-1)!.date).toBe('2027-05-20');
    expect(days.find((d) => d.date === '2027-04-09')!.off).toBe('unavailable');
    expect(days.find((d) => d.date === '2027-05-21')!.off).toBe('unavailable');
  });

  it('a month ending on a Sunday leaves no empty row', () => {
    const feb = calMonths({ start: '2027-02-01', end: '2027-02-28' }, [], null);
    expect(feb[0]!.rows).toHaveLength(4); // Feb 2027: Mon 1st .. Sun 28th
  });
});

describe('ruleAllows', () => {
  it.each([
    ['any-day', '2027-05-05', true],
    ['weekend', '2027-05-07', false],
    ['weekend', '2027-05-08', true],
    ['weekend', '2027-05-09', true],
    ['weekend-or-thu-fri', '2027-05-05', false],
    ['weekend-or-thu-fri', '2027-05-06', true],
    ['weekend-or-thu-fri', '2027-05-09', true],
  ] as const)('%s %s -> %s', (rule, date, ok) => {
    expect(ruleAllows(rule, date)).toBe(ok);
  });
  it('no rule allows every day', () => {
    expect(ruleAllows(null, '2027-05-03')).toBe(true);
  });
});

describe('toggleDate', () => {
  it('picks, un-picks, and a third pick swaps out the oldest', () => {
    expect(toggleDate([], 'a')).toEqual({ order: ['a'], swapped: null });
    expect(toggleDate(['a'], 'b')).toEqual({ order: ['a', 'b'], swapped: null });
    expect(toggleDate(['a', 'b'], 'c')).toEqual({ order: ['b', 'c'], swapped: 'a' });
    expect(toggleDate(['a', 'b'], 'a')).toEqual({ order: ['b'], swapped: null });
  });
});

describe('stepDay', () => {
  const days = allDays(calMonths(SEASON, AWAY, null));
  it('arrows move by a day and a week, across months', () => {
    expect(stepDay(days, '2027-05-12', 'ArrowRight')).toBe('2027-05-13');
    expect(stepDay(days, '2027-05-12', 'ArrowLeft')).toBe('2027-05-11');
    expect(stepDay(days, '2027-05-12', 'ArrowDown')).toBe('2027-05-19');
    expect(stepDay(days, '2027-05-12', 'ArrowUp')).toBe('2027-05-05');
    expect(stepDay(days, '2027-05-31', 'ArrowRight')).toBe('2027-06-01');
    expect(stepDay(days, '2027-06-01', 'ArrowLeft')).toBe('2027-05-31');
  });
  it('steps over off days in the direction of the key', () => {
    expect(stepDay(days, '2027-04-23', 'ArrowRight')).toBe('2027-05-04');
    expect(stepDay(days, '2027-05-04', 'ArrowLeft')).toBe('2027-04-23');
    expect(stepDay(days, '2027-04-20', 'ArrowDown')).toBe('2027-05-04'); // Apr 27 is away: on to the next open day
    expect(stepDay(days, '2027-05-06', 'ArrowUp')).toBe('2027-04-23'); // Apr 29 away: back a day at a time
  });
  it('stops at the season edges', () => {
    expect(stepDay(days, '2027-04-01', 'ArrowLeft')).toBeNull();
    expect(stepDay(days, '2027-04-03', 'ArrowUp')).toBeNull();
    expect(stepDay(days, '2027-06-30', 'ArrowRight')).toBeNull();
    expect(stepDay(days, '2027-06-28', 'ArrowDown')).toBeNull();
  });
  it('Home and End go to the week’s ends; PageUp and PageDown to the same day a month over', () => {
    expect(stepDay(days, '2027-05-12', 'Home')).toBe('2027-05-10');
    expect(stepDay(days, '2027-05-12', 'End')).toBe('2027-05-16');
    expect(stepDay(days, '2027-04-02', 'Home')).toBe('2027-04-01'); // the week starts before the season
    expect(stepDay(days, '2027-05-12', 'PageDown')).toBe('2027-06-12');
    expect(stepDay(days, '2027-05-12', 'PageUp')).toBe('2027-04-12');
    expect(stepDay(days, '2027-05-31', 'PageDown')).toBe('2027-06-30'); // clamped to June's last day
    expect(stepDay(days, '2027-06-12', 'PageDown')).toBeNull();
    expect(stepDay(days, '2027-04-12', 'PageUp')).toBeNull();
    expect(stepDay(days, '2027-05-12', 'x')).toBeNull();
    expect(stepDay(days, '1999-01-01', 'ArrowRight')).toBeNull();
  });
  it('Home on the week’s first day is no move', () => {
    expect(stepDay(days, '2027-05-10', 'Home')).toBeNull();
    expect(stepDay(days, '2027-05-16', 'End')).toBeNull();
  });
});

describe('the Tab stop and the first month', () => {
  const months = calMonths(SEASON, AWAY, null);
  it('the active day, else the month’s oldest pick, else its first open day', () => {
    expect(tabStopDay(months, [], '2027-05')).toBe('2027-05-04');
    expect(tabStopDay(months, ['2027-05-20', '2027-05-08'], '2027-05')).toBe('2027-05-20');
    expect(tabStopDay(months, ['2027-04-08'], '2027-05')).toBe('2027-05-04'); // the pick is in another month
    expect(tabStopDay(months, ['2027-05-20'], '2027-05', '2027-05-11')).toBe('2027-05-11');
    expect(tabStopDay(months, [], '2027-05', '2027-04-11')).toBe('2027-05-04'); // active elsewhere
    expect(tabStopDay(months, [], '2027-05', '2027-05-01')).toBe('2027-05-04'); // active is off
  });
  it('a month with nothing open falls back to the season’s first open day', () => {
    const shut = calMonths(
      SEASON,
      allDays(months)
        .filter((d) => d.date < '2027-05-10')
        .map((d) => d.date),
      null,
    );
    expect(tabStopDay(shut, [], '2027-04')).toBe('2027-05-10');
    expect(tabStopDay(shut, [], 'nope')).toBe('2027-05-10');
    expect(
      tabStopDay(
        calMonths(
          SEASON,
          allDays(months).map((d) => d.date),
          null,
        ),
        [],
        '2027-04',
      ),
    ).toBeNull();
  });
  it('opens on the oldest pick’s month, else the first month with an open day', () => {
    expect(initialCalMonth(months, ['2027-06-03'])).toBe('2027-06');
    expect(initialCalMonth(months, [])).toBe('2027-04');
    const aprilShut = calMonths(
      SEASON,
      monthDays(months[0]!).map((d) => d.date),
      null,
    );
    expect(initialCalMonth(aprilShut, [])).toBe('2027-05');
    expect(initialCalMonth(aprilShut, ['1999-01-01'])).toBe('2027-05');
    expect(initialCalMonth([], [])).toBe('');
  });
});
