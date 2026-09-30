// T2.5.U1 / T3.5.U1: the A4 week rows match the pack's a4-season words (designs/final/a4-season-design-*.html).
import { describe, expect, it } from 'vitest';
import type { SeasonView, SeasonWeek } from '@/features/admin/season-view';
import { vancouverInstant } from '@/lib/time';
import { clock, currentAway, timeRange, weekCount, weekNotes, weekRows, windowTime } from '../model';

const END = '2027-06-30';
const at = (d: string, t: string) => vancouverInstant(d, t);
const iso = (d: string, t: string) => at(d, t).toISOString();

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
const who = (id: string, contactName: string) => ({
  id,
  contactName,
  dish: 'big-day',
  dishName: 'Big Day',
  isTest: false,
});
const view = (weeks: SeasonWeek[], householdHoldReleased = false): SeasonView => ({
  defaultWeeklyCap: 2,
  householdHoldReleased,
  mainCalendar: 'ok',
  mainCalendarAsOf: null,
  weeks,
});
const flat = (notes: ReturnType<typeof weekNotes>) =>
  notes.map((n) =>
    [n.lead, n.day && n.time ? `${n.day} · ${n.time}` : n.day, n.text].filter(Boolean).join(' '),
  );

describe('clock / timeRange / windowTime', () => {
  it('names noon, drops :00, keeps minutes and shares a meridiem', () => {
    expect(clock(at('2027-04-15', '12:00'))).toBe('noon');
    expect(clock(at('2027-04-15', '19:00'))).toBe('7 pm');
    expect(clock(at('2027-04-15', '09:30'))).toBe('9:30 am');
    expect(clock(at('2027-04-15', '00:00'))).toBe('12 am');
    expect(timeRange(at('2027-04-15', '12:00'), at('2027-04-15', '14:00'))).toBe('noon–2 pm');
    expect(timeRange(at('2027-04-15', '09:00'), at('2027-04-15', '11:00'))).toBe('9–11 am');
    expect(timeRange(at('2027-04-15', '11:00'), at('2027-04-15', '13:00'))).toBe('11 am–1 pm');
    expect(timeRange(at('2027-04-15', '10:00'), at('2027-04-15', '12:00'))).toBe('10 am–noon');
    expect(windowTime('evening', at('2027-04-15', '19:00'), at('2027-04-15', '22:00'))).toBe('7 pm');
    expect(windowTime('lunch', at('2027-04-15', '12:00'), at('2027-04-15', '14:00'))).toBe('noon–2 pm');
  });
});

describe('weekNotes (pack a4-season order and words)', () => {
  it('Mar 29: the household hold until it is released', () => {
    const w = week('2027-03-29');
    expect(flat(weekNotes(w, view([w]), END))).toEqual(['Thu Apr 1 · noon–2 pm held for family']);
    expect(weekNotes(w, view([w], true), END)).toEqual([]);
    expect(weekNotes(week('2027-04-05'), view([]), END)).toEqual([]);
  });

  it('Apr 12: blocked day, Big Day with the name, stand-by count', () => {
    const w = week('2027-04-12', {
      capUsed: 1,
      blocks: [
        {
          id: 'b1',
          startDate: '2027-04-16',
          endDate: '2027-04-16',
          kind: 'blocked',
          confirmBy: null,
          note: null,
        },
      ],
      bookings: [
        {
          ...who('r1', 'Wes'),
          status: 'locked',
          startsAt: iso('2027-04-17', '10:00'),
          endsAt: iso('2027-04-17', '18:00'),
          countsToward: 'big_day',
          joinedGuests: 0,
        },
        {
          ...who('r2', 'Robin'),
          status: 'locked',
          startsAt: iso('2027-04-16', '19:00'),
          endsAt: iso('2027-04-16', '21:00'),
          countsToward: 'weekly_cap',
          joinedGuests: 0,
        },
      ],
      standby: [{ ...who('s1', 'Chris'), createdAt: iso('2027-03-01', '09:00') }],
    });
    expect(flat(weekNotes(w, view([w], true), END))).toEqual([
      'Fri Apr 16 blocked',
      'Big Day Sat Apr 17 (Wes)',
      '1 on stand-by',
    ]);
    expect(weekCount(w, END)).toBe('1 of 2');
  });

  it('a block reaching past the week is clipped to the week', () => {
    const w = week('2027-04-12', {
      blocks: [
        {
          id: 'b2',
          startDate: '2027-04-10',
          endDate: '2027-04-14',
          kind: 'blocked',
          confirmBy: null,
          note: null,
        },
      ],
    });
    expect(flat(weekNotes(w, view([w], true), END))).toEqual(['Mon Apr 12 – Wed Apr 14 blocked']);
    const tail = week('2027-04-12', {
      blocks: [
        {
          id: 'b3',
          startDate: '2027-04-17',
          endDate: '2027-04-21',
          kind: 'blocked',
          confirmBy: null,
          note: null,
        },
      ],
    });
    expect(flat(weekNotes(tail, view([tail], true), END))).toEqual(['Sat Apr 17 – Sun Apr 18 blocked']);
  });

  it('May 17: a busy marker from the main calendar (T3.5.U1)', () => {
    const w = week('2027-05-17', {
      busy: [{ startsAt: iso('2027-05-20', '12:00'), endsAt: iso('2027-05-20', '14:00') }],
    });
    expect(flat(weekNotes(w, view([w], true), END))).toEqual([
      'Thu May 20 · noon–2 pm busy on your calendar',
    ]);
  });

  it('Apr 26: a week inside away mode reads Away with the range; a partly covered week does not', () => {
    const away = {
      id: 'a1',
      startDate: '2027-04-24',
      endDate: '2027-05-03',
      kind: 'away' as const,
      confirmBy: '2027-05-05',
      note: null,
    };
    const inside = week('2027-04-26', { blocks: [away] });
    expect(weekCount(inside, END)).toBe('Away');
    expect(flat(weekNotes(inside, view([inside], true), END))).toEqual(['Away Apr 24 – May 3']);
    const edge = week('2027-04-19', { capUsed: 1, blocks: [away] });
    expect(weekCount(edge, END)).toBe('1 of 2');
    expect(weekNotes(edge, view([edge], true), END)).toEqual([]);
    const lastDay = week('2027-05-03', { blocks: [away] });
    expect(weekCount(lastDay, END)).toBe('0 of 2');
  });

  it('Jun 28: the last short week reads Mon–Wed with the season end notes', () => {
    const w = week('2027-06-28');
    expect(weekCount(w, END)).toBe('Mon–Wed');
    expect(flat(weekNotes(w, view([w], true), END))).toEqual([
      'Season ends Wed Jun 30',
      'Big Days, The Encore or The Long Distance only',
    ]);
    expect(weekCount(week('2027-06-21'), END)).toBe('0 of 2');
    // a season ending on a Sunday has no short week
    expect(weekCount(week('2027-06-21'), '2027-06-27')).toBe('0 of 2');
  });

  it('shows the cap override count', () => {
    expect(weekCount(week('2027-05-31', { cap: 3, capUsed: 2, capOverride: 3 }), END)).toBe('2 of 3');
  });
});

describe('weekRows / currentAway', () => {
  const away = {
    id: 'a1',
    startDate: '2027-04-24',
    endDate: '2027-05-03',
    kind: 'away' as const,
    confirmBy: '2027-05-05',
    note: null,
  };
  const later = { ...away, id: 'a2', startDate: '2027-06-01', endDate: '2027-06-03' };
  const v = view(
    [
      week('2027-04-19', { blocks: [away] }),
      week('2027-04-26', { blocks: [away] }),
      week('2027-05-31', { blocks: [later] }),
    ],
    true,
  );

  it('labels each week and flags the away weeks', () => {
    expect(weekRows(v, END).map((r) => [r.label, r.count, r.away])).toEqual([
      ['Apr 19', '0 of 2', false],
      ['Apr 26', 'Away', true],
      ['May 31', '0 of 2', false],
    ]);
  });

  it('the card shows the away range running or next, never a past one', () => {
    expect(currentAway(v, '2027-03-01')?.id).toBe('a1');
    expect(currentAway(v, '2027-05-03')?.id).toBe('a1');
    expect(currentAway(v, '2027-05-04')?.id).toBe('a2');
    expect(currentAway(v, '2027-06-04')).toBeNull();
  });
});
