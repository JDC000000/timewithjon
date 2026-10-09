import { describe, expect, it } from 'vitest';
import type { WeekOut } from '@/features/availability/types';
import { addCivilDays, dayRange, longDate, parseCivil, shortDate } from '@/lib/civil';
import {
  initialMonth,
  monthStandbyWeeks,
  monthTileIds,
  pickerMonths,
  tilesInOrder,
  tileView,
  weekCaption,
} from '../picker-model';

// 2027: Apr 1 is a Thursday, so the season's weeks start on Mondays Mar 29, Apr 5, …
const win = (date: string, window: 'lunch' | 'evening' = 'lunch') => ({
  slotId: `${date}-${window}`,
  date,
  window,
  label: 'engine label, unused',
});
const open = (weekStart: string, dates: string[]): WeekOut => ({
  weekStart,
  state: 'open',
  windows: dates.map((d) => win(d)),
});
const state = (weekStart: string, s: WeekOut['state']): WeekOut => ({ weekStart, state: s, windows: [] });

describe('civil dates', () => {
  it('reads weekdays and formats without any time zone', () => {
    expect(parseCivil('2027-04-01').weekday).toBe(4);
    expect(parseCivil('2027-04-04').weekday).toBe(7);
    expect(parseCivil('2027-03-29').weekday).toBe(1);
    expect(shortDate('2027-05-06')).toBe('Thu May 6');
    expect(longDate('2027-05-16')).toBe('Sunday May 16');
    expect(addCivilDays('2027-04-29', 3)).toBe('2027-05-02');
    expect(addCivilDays('2027-05-02', -3)).toBe('2027-04-29');
  });
  it('keeps a range in one month short and names both months across a boundary', () => {
    expect(dayRange('2027-04-01', '2027-04-02')).toBe('Apr 1–2');
    expect(dayRange('2027-04-30', '2027-05-01')).toBe('Apr 30–May 1');
    expect(dayRange('2027-06-24', '2027-06-24')).toBe('Jun 24');
  });
});

describe('tiles', () => {
  it('lunch reads "noon" on the tile and "noon–2 pm" elsewhere (G1 #14)', () => {
    expect(tileView(win('2027-05-06'))).toEqual({
      slotId: '2027-05-06-lunch',
      date: '2027-05-06',
      window: 'lunch',
      day: 'Thu',
      time: 'noon',
      spoken: 'noon–2 pm, May 6',
      label: 'Thu May 6 · noon–2 pm',
    });
  });
  it('evening reads "7 pm" everywhere', () => {
    const t = tileView(win('2027-05-07', 'evening'));
    expect([t.day, t.time, t.spoken, t.label]).toEqual(['Fri', '7 pm', '7 pm, May 7', 'Fri May 7 · 7 pm']);
  });
  it('a week is captioned by its Thursday and Friday', () => {
    expect(weekCaption('2027-03-29')).toBe('Apr 1–2');
    expect(weekCaption('2027-04-26')).toBe('Apr 29–30');
  });
});

describe('pickerMonths', () => {
  const weeks: WeekOut[] = [
    open('2027-03-29', ['2027-04-02']),
    state('2027-04-12', 'spoken_for'),
    state('2027-04-26', 'away'),
    open('2027-05-03', ['2027-05-06', '2027-05-07']),
    state('2027-05-31', 'spoken_for'),
    state('2027-06-07', 'spoken_for'),
    state('2027-06-14', 'spoken_for'),
    open('2027-06-21', ['2027-06-24']),
    state('2027-06-28', 'closed'),
    open('2027-05-10', []),
  ];
  const months = pickerMonths(weeks);
  const month = (i: number) => {
    const m = months[i];
    if (!m) throw new Error(`no month ${i}`);
    return m;
  };

  it('groups rows by the month of their Thursday, in order', () => {
    expect(months.map((m) => [m.key, m.name])).toEqual([
      ['2027-04', 'April'],
      ['2027-05', 'May'],
      ['2027-06', 'June'],
    ]);
  });
  it('shows a lone spoken-for week with its stand-by, an away week, and hides closed or empty weeks', () => {
    expect(month(0).rows.map((r) => r.kind)).toEqual(['week', 'spoken', 'away']);
    expect(month(0).rows[1]).toMatchObject({ caption: 'Apr 15–16', weekStart: '2027-04-12' });
    expect(month(1).rows.map((r) => r.key)).toEqual(['2027-05-03']);
  });
  it('collapses 2+ spoken-for weeks into one run with its first and last week (T1.5.U4)', () => {
    expect(month(2).rows[0]).toEqual({
      kind: 'run',
      key: 'run-2027-05-31',
      weekStart: '2027-05-31',
      firstCaption: 'Jun 3–4',
      lastCaption: 'Jun 17–18',
    });
    expect(month(2).rows[1]).toMatchObject({ kind: 'week', caption: 'Jun 24–25' });
  });
  it('lists tile ids and stand-by weeks per month', () => {
    expect(monthTileIds(month(1))).toEqual(['2027-05-06-lunch', '2027-05-07-lunch']);
    expect(monthStandbyWeeks(month(0))).toEqual(['2027-04-12']);
    expect(monthStandbyWeeks(month(2))).toEqual(['2027-05-31']);
    expect(tilesInOrder(months).map((t) => t.slotId)).toEqual([
      '2027-04-02-lunch',
      '2027-05-06-lunch',
      '2027-05-07-lunch',
      '2027-06-24-lunch',
    ]);
  });
  it('opens on the month holding a pick, else a stand-by week, else the first month with a time', () => {
    expect(initialMonth(months, ['2027-06-24-lunch'], null)).toBe('2027-06');
    expect(initialMonth(months, [], '2027-05-31')).toBe('2027-06');
    expect(initialMonth(months, [], null)).toBe('2027-04');
    const late = pickerMonths([state('2027-03-29', 'away'), open('2027-05-03', ['2027-05-06'])]);
    expect(initialMonth(late, [], null)).toBe('2027-05');
    expect(initialMonth(pickerMonths([state('2027-03-29', 'away')]), [], null)).toBe('2027-04');
    expect(initialMonth([], [], null)).toBe('');
  });
});
