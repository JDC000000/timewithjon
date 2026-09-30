// T2.5.U1 / T3.5.U1: the A4b week pane model, against the pack's a4b-week (designs/final/a4b-week-design-*.html) with
// one Open/Blocked choice per date (orchestrator ruling Q1).
import { describe, expect, it } from 'vitest';
import type { Slot } from '@/features/availability/types';
import type { SeasonBlock, SeasonWeek } from '@/features/admin/season-view';
import { vancouverInstant } from '@/lib/time';
import { dateSpan, weekDetail, type WeekInput } from '../week-model';

const at = (d: string, t: string) => vancouverInstant(d, t);
const iso = (d: string, t: string) => at(d, t).toISOString();
const lunch = (date: string): Slot => ({
  id: `${date}-l`,
  date,
  windowKind: 'lunch',
  startsAt: at(date, '12:00'),
  endsAt: at(date, '14:00'),
});
const evening = (date: string): Slot => ({
  id: `${date}-e`,
  date,
  windowKind: 'evening',
  startsAt: at(date, '19:00'),
  endsAt: at(date, '22:00'),
});
const thuFri = (thu: string, fri: string) => [evening(fri), lunch(thu), evening(thu), lunch(fri)];
const block = (id: string, startDate: string, endDate: string, kind: SeasonBlock['kind'] = 'blocked') => ({
  id,
  startDate,
  endDate,
  kind,
  confirmBy: null,
  note: null,
});
const who = (id: string, contactName: string, dishName: string | null = 'The Long Lunch') => ({
  id,
  contactName,
  dish: 'long-lunch',
  dishName,
  isTest: false,
});
function week(weekStart: string, over: Partial<SeasonWeek> = {}): SeasonWeek {
  return {
    weekStart,
    capOverride: null,
    cap: 2,
    capUsed: 0,
    bookings: [],
    pendingTaps: [],
    standby: [],
    blocks: [],
    busy: [],
    ...over,
  };
}
const input = (w: SeasonWeek, over: Partial<WeekInput> = {}): WeekInput => ({
  week: w,
  slots: thuFri(
    w.weekStart.replace(/-\d\d$/, `-${String(Number(w.weekStart.slice(8)) + 3).padStart(2, '0')}`),
    w.weekStart.replace(/-\d\d$/, `-${String(Number(w.weekStart.slice(8)) + 4).padStart(2, '0')}`),
  ),
  today: '2027-03-03',
  seasonEnd: '2027-06-30',
  householdHoldReleased: false,
  defaultWeeklyCap: 2,
  offers: new Map(),
  ...over,
});
const lines = (d: { windows: { time: string; note: string }[] }) =>
  d.windows.map((w) => [w.time, w.note].filter(Boolean).join(' · '));

describe('weekDetail: the pack week of Apr 12', () => {
  const robin = {
    ...who('r-robin', 'Robin'),
    status: 'locked' as const,
    startsAt: iso('2027-04-16', '19:00'),
    endsAt: iso('2027-04-16', '22:00'),
    countsToward: 'weekly_cap' as const,
    joinedGuests: 0,
  };
  const w = week('2027-04-12', {
    capUsed: 1,
    bookings: [robin],
    blocks: [block('b-fri', '2027-04-16', '2027-04-16')],
    standby: [{ ...who('r-chris', 'Chris', 'The Flat White'), createdAt: iso('2027-03-01', '09:00') }],
  });
  const d = weekDetail(input(w, { offers: new Map([['r-chris', lunch('2027-04-15')]]) }));

  it('heads the pane like the pack', () => {
    expect([d.label, d.count, d.heading, d.weekEnd]).toEqual(['Apr 12', '1 of 2', 'Apr 15–16', '2027-04-18']);
  });

  it('lists each date once, in order, with its windows under it', () => {
    expect(d.dates.map((x) => [x.label, x.state, x.editable, x.blockId])).toEqual([
      ['Thu Apr 15', 'open', true, null],
      ['Fri Apr 16', 'blocked', true, 'b-fri'],
    ]);
    expect(d.dates.map(lines)).toEqual([
      ['noon–2 pm · Open', '7 pm · Open'],
      ['noon–2 pm · Blocked by you', '7 pm · Locked · Robin'],
    ]);
    expect(d.dates[1]!.windows[1]!.booking).toEqual({ id: 'r-robin', name: 'Robin' });
    expect(d.dates[0]!.windows[0]!.booking).toBeNull();
  });

  it('offers the stand-by guest the first open window', () => {
    expect(d.standby).toEqual([
      {
        id: 'r-chris',
        name: 'Chris',
        who: 'Chris · The Flat White',
        since: 'Mon Mar 1',
        offer: { slotId: '2027-04-15-l', label: 'Thu noon–2 pm' },
      },
    ]);
  });

  it('the whole week is open and editable; no 3rd', () => {
    expect(d.wholeWeek).toEqual({ blocked: false, blockId: null, editable: true });
    expect(d.allowThird).toBe(false);
  });
});

describe('weekDetail: blocks, away, the past', () => {
  it('a whole-week block: undone as one (its id), the dates are not flipped one by one', () => {
    const d = weekDetail(input(week('2027-04-12', { blocks: [block('b-w', '2027-04-12', '2027-04-18')] })));
    expect(d.wholeWeek).toEqual({ blocked: true, blockId: 'b-w', editable: true });
    expect(d.dates.map((x) => [x.state, x.editable, x.blockId])).toEqual([
      ['blocked', false, null],
      ['blocked', false, null],
    ]);
  });

  it('a longer block across the week: shown, but not undone from here', () => {
    const d = weekDetail(input(week('2027-04-12', { blocks: [block('b-l', '2027-04-10', '2027-04-20')] })));
    expect(d.wholeWeek).toEqual({ blocked: true, blockId: null, editable: false });
  });

  it('a block from before the week to mid-week is not the whole week; one past its Sunday is not undone here', () => {
    const early = weekDetail(
      input(week('2027-04-12', { blocks: [block('b-e', '2027-04-10', '2027-04-14')] })),
    );
    expect(early.wholeWeek.blocked).toBe(false);
    const late = weekDetail(
      input(week('2027-04-12', { blocks: [block('b-x', '2027-04-12', '2027-04-20')] })),
    );
    expect(late.wholeWeek).toEqual({ blocked: true, blockId: null, editable: false });
  });

  it('a two-day block inside the week: the week stays unblocked', () => {
    const d = weekDetail(input(week('2027-04-12', { blocks: [block('b-2', '2027-04-15', '2027-04-16')] })));
    expect(d.wholeWeek.blocked).toBe(false);
    expect(d.dates.map((x) => [x.state, x.editable])).toEqual([
      ['blocked', false],
      ['blocked', false],
    ]);
  });

  it('away dates say Away and are edited in away mode', () => {
    const d = weekDetail(
      input(week('2027-04-26', { blocks: [block('a', '2027-04-24', '2027-04-29', 'away')] }), {
        slots: thuFri('2027-04-29', '2027-04-30'),
      }),
    );
    expect(d.heading).toBe('Apr 29–30');
    expect(d.dates.map((x) => [x.state, x.editable])).toEqual([
      ['away', false],
      ['open', true],
    ]);
    expect(lines(d.dates[0]!)).toEqual(['noon–2 pm · Away', '7 pm · Away']);
  });

  it('past dates: no choice, no note on a free window, a done booking says Done', () => {
    const done = {
      ...who('r-lee', 'Lee'),
      status: 'done' as const,
      startsAt: iso('2027-04-15', '12:00'),
      endsAt: iso('2027-04-15', '14:00'),
      countsToward: 'weekly_cap' as const,
      joinedGuests: 0,
    };
    const d = weekDetail(input(week('2027-04-12', { bookings: [done] }), { today: '2027-04-16' }));
    expect(d.dates.map((x) => [x.state, x.editable])).toEqual([
      ['past', false],
      ['open', true],
    ]);
    expect(lines(d.dates[0]!)).toEqual(['noon–2 pm · Done · Lee', '7 pm']);
    expect(d.wholeWeek.editable).toBe(true);
    const gone = weekDetail(input(week('2027-04-12'), { today: '2027-04-19' }));
    expect(gone.wholeWeek.editable).toBe(false);
    expect(weekDetail(input(week('2027-04-12'), { today: '2027-04-18' })).wholeWeek.editable).toBe(true);
  });
});

describe('weekDetail: window notes', () => {
  it('the household hold (Thu Apr 1 lunch) until it is released', () => {
    const w = week('2027-03-29');
    const slots = thuFri('2027-04-01', '2027-04-02');
    expect(lines(weekDetail(input(w, { slots })).dates[0]!)).toEqual([
      'noon–2 pm · Held for family',
      '7 pm · Open',
    ]);
    expect(lines(weekDetail(input(w, { slots, householdHoldReleased: true })).dates[0]!)).toEqual([
      'noon–2 pm · Open',
      '7 pm · Open',
    ]);
    expect(weekDetail(input(w, { slots })).heading).toBe('Apr 1–2');
  });

  it('T3.5.U1: busy on the main calendar when it overlaps, not when it only touches', () => {
    const w = week('2027-05-17', {
      busy: [
        { startsAt: iso('2027-05-20', '13:00'), endsAt: iso('2027-05-20', '13:30') },
        { startsAt: iso('2027-05-21', '14:00'), endsAt: iso('2027-05-21', '19:00') },
      ],
    });
    const d = weekDetail(input(w, { slots: thuFri('2027-05-20', '2027-05-21') }));
    expect(d.dates.map(lines)).toEqual([
      ['noon–2 pm · Busy on your calendar', '7 pm · Open'],
      ['noon–2 pm · Open', '7 pm · Open'],
    ]);
  });

  it('ignores slots outside the week; an empty week heads with its Monday', () => {
    const d = weekDetail(input(week('2027-05-03'), { slots: [lunch('2027-05-02'), lunch('2027-05-10')] }));
    expect(d.dates).toEqual([]);
    expect(d.heading).toBe('May 3');
  });

  it('a booking that only touches a window (ends as it starts) is not in it', () => {
    const touch = {
      ...who('r-t', 'Tess'),
      status: 'locked' as const,
      startsAt: iso('2027-04-15', '14:00'),
      endsAt: iso('2027-04-15', '16:00'),
      countsToward: 'weekly_cap' as const,
      joinedGuests: 0,
    };
    const d = weekDetail(input(week('2027-04-12', { bookings: [touch] })));
    expect(lines(d.dates[0]!)).toEqual(['noon–2 pm · Open', '7 pm · Open']);
  });

  it('allow a 3rd: on at a cap of 3 or more', () => {
    const at3 = (capOverride: number | null, defaultWeeklyCap = 2) =>
      weekDetail(input(week('2027-04-12', { capOverride }), { defaultWeeklyCap })).allowThird;
    expect([at3(null), at3(2), at3(3), at3(4), at3(null, 3), at3(0, 3)]).toEqual([
      false,
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it('a stand-by guest with nothing open this week gets no offer; no dish name, just the name', () => {
    const w = week('2027-04-12', {
      standby: [{ ...who('r-x', 'Sam', null), createdAt: '2027-04-06T06:30:00.000Z' }],
    });
    expect(weekDetail(input(w)).standby[0]).toMatchObject({ who: 'Sam', since: 'Mon Apr 5', offer: null });
  });
});

describe('dateSpan', () => {
  it('names the span like the pack', () => {
    expect(dateSpan('2027-04-15', '2027-04-16')).toBe('Apr 15–16');
    expect(dateSpan('2027-04-29', '2027-05-01')).toBe('Apr 29–May 1');
    expect(dateSpan('2027-04-15', '2027-04-15')).toBe('Apr 15');
  });
});
