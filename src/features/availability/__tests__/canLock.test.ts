// src/lib/engine/__tests__/canLock.test.ts — T0.5 AC 4, 17, 21, 22, 23
import { describe, expect, it } from 'vitest';
import { canLock, type CanLockInput } from '@/features/availability';
import { baseInput, booking, slot } from '@/features/availability/fixtures';
import { vancouverInstant } from '@/lib/time';

const base = baseInput();
const input = (over: Partial<CanLockInput>): CanLockInput => ({
  now: base.now,
  request: { id: 'me', status: 'requested', countsToward: 'weekly_cap', dish: 'the-long-lunch' },
  mode: 'lock',
  target: { slot: slot(base, '2027-05-13', 'lunch') },
  bookings: [],
  blocks: [],
  weeks: base.weeks,
  offers: [],
  settings: base.settings,
  ...over,
});

describe('C3 canLock', () => {
  it('AC4 a lunch and an evening on the same Thursday both lock', () => {
    expect(canLock(input({})).ok).toBe(true);
    const lunch = booking('2027-05-13', '12:00', '14:00', 'weekly_cap');
    expect(
      canLock(input({ target: { slot: slot(base, '2027-05-13', 'evening') }, bookings: [lunch] })).ok,
    ).toBe(true);
  });
  it('AC17 Encore Sun Jun 27 counts toward week of Jun 21; Tue Jun 29 is lockable', () => {
    const encoreSun = booking('2027-06-27', '19:30', '23:00', 'weekly_cap');
    const thu = booking('2027-06-24', '12:00', '14:00', 'weekly_cap');
    const r = canLock(
      input({ target: { slot: slot(base, '2027-06-25', 'lunch') }, bookings: [encoreSun, thu] }),
    );
    expect(r).toEqual({ ok: false, reason: 'week_full' });
    const tue = {
      range: {
        startsAt: vancouverInstant('2027-06-29', '19:30'),
        endsAt: vancouverInstant('2027-06-29', '23:00'),
      },
    };
    // L9: with the Jun 21 week full, Tue Jun 29 (week of Jun 28) still locks.
    expect(canLock(input({ target: tue, bookings: [encoreSun, thu] })).ok).toBe(true);
  });
  it('L7 refuses a time that has already started', () => {
    const later = new Date('2027-05-20T18:00:00Z');
    expect(canLock(input({ now: later, target: { slot: slot(base, '2027-04-08', 'lunch') } }))).toEqual({
      ok: false,
      reason: 'in_the_past',
    });
  });
  it('L7 judges the season on the start date: an Encore Wed Jun 30 past midnight locks', () => {
    const encore = {
      range: {
        startsAt: vancouverInstant('2027-06-30', '20:00'),
        endsAt: vancouverInstant('2027-07-01', '00:30'),
      },
    };
    expect(canLock(input({ target: encore })).ok).toBe(true);
  });
  it('AC21 Big Day vs Thu/Fri booking clash both ways unless Book anyway', () => {
    const bigDay = {
      range: {
        startsAt: vancouverInstant('2027-05-14', '09:00'),
        endsAt: vancouverInstant('2027-05-14', '13:00'),
      },
    };
    const evening = booking('2027-05-14', '19:00', '22:00', 'weekly_cap');
    const bd = {
      id: 'me',
      status: 'requested' as const,
      countsToward: 'big_day' as const,
      dish: 'the-grind',
    };
    expect(canLock(input({ request: bd, target: bigDay, bookings: [evening] }))).toEqual({
      ok: false,
      reason: 'big_day_clash',
    });
    expect(canLock(input({ request: bd, target: bigDay, bookings: [evening], bookAnyway: true })).ok).toBe(
      true,
    );
    const lockedBigDay = booking('2027-05-14', '09:00', '13:00', 'big_day');
    expect(
      canLock(input({ target: { slot: slot(base, '2027-05-14', 'evening') }, bookings: [lockedBigDay] })),
    ).toEqual({ ok: false, reason: 'big_day_clash' });
  });
  it('AC23 canLock accepts a date range for a dates-mode booking; third weekly lock needs override', () => {
    const range = {
      range: {
        startsAt: vancouverInstant('2027-05-22', '19:30'),
        endsAt: vancouverInstant('2027-05-22', '23:00'),
      },
    };
    expect(canLock(input({ target: range })).ok).toBe(true);
    const two = [
      booking('2027-05-20', '12:00', '14:00', 'weekly_cap'),
      booking('2027-05-21', '12:00', '14:00', 'weekly_cap'),
    ];
    expect(canLock(input({ target: range, bookings: two }))).toEqual({ ok: false, reason: 'week_full' });
    expect(canLock(input({ target: range, bookings: two, overrideWeek: true })).ok).toBe(true);
  });
  it('refuses a cancelled request and a taken range (409 mapping)', () => {
    expect(
      canLock(
        input({
          request: { id: 'me', status: 'cancelled', countsToward: 'weekly_cap', dish: 'the-long-lunch' },
        }),
      ),
    ).toEqual({ ok: false, reason: 'cancelled' });
    expect(canLock(input({ bookings: [booking('2027-05-13', '12:00', '14:00', 'weekly_cap')] }))).toEqual({
      ok: false,
      reason: 'time_taken',
    });
  });
});

describe('decision 43(4): Something New, at most 1 a week', () => {
  const sn = {
    id: 'me',
    status: 'requested' as const,
    countsToward: 'weekly_cap' as const,
    dish: 'something-new',
  };
  const at = (date: string, from: string, to: string) => ({
    range: { startsAt: vancouverInstant(date, from), endsAt: vancouverInstant(date, to) },
  });
  // Mon May 10 .. Sun May 16, 2027 is one week; Mon May 17 starts the next.
  const lockedSn = booking('2027-05-11', '19:00', '22:00', 'weekly_cap', { dish: 'something-new' });

  it('a second Something New in the same week is refused, even with the weekly cap not met', () => {
    expect(canLock(input({ request: sn, target: at('2027-05-16', '10:00', '14:00') })).ok).toBe(true);
    expect(
      canLock(input({ request: sn, target: at('2027-05-16', '10:00', '14:00'), bookings: [lockedSn] })),
    ).toEqual({ ok: false, reason: 'week_full' });
  });
  it('Override this week lifts it; the next week (Mon May 17) and the week before are free', () => {
    const bookings = [lockedSn];
    expect(
      canLock(
        input({ request: sn, target: at('2027-05-16', '10:00', '14:00'), bookings, overrideWeek: true }),
      ).ok,
    ).toBe(true);
    expect(canLock(input({ request: sn, target: at('2027-05-17', '19:00', '22:00'), bookings })).ok).toBe(
      true,
    );
    expect(canLock(input({ request: sn, target: at('2027-05-09', '10:00', '14:00'), bookings })).ok).toBe(
      true,
    );
  });
  it('other dishes are not limited by it, and a Something New ignores other dishes', () => {
    const encore = booking('2027-05-11', '19:00', '22:00', 'weekly_cap', { dish: 'the-encore' });
    expect(
      canLock(input({ request: sn, target: at('2027-05-15', '19:00', '22:00'), bookings: [encore] })).ok,
    ).toBe(true);
    const lunch = { ...sn, dish: 'the-long-lunch' };
    expect(canLock(input({ request: lunch, bookings: [lockedSn] })).ok).toBe(true);
  });
  it('a joined request never counts toward the week', () => {
    const joined = { ...lockedSn, joinedToRequestId: 'host' };
    expect(
      canLock(input({ request: sn, target: at('2027-05-16', '10:00', '14:00'), bookings: [joined] })).ok,
    ).toBe(true);
  });
  it('the week is judged by the start date (Vancouver): a Sunday-night booking belongs to its Sunday', () => {
    const sunLate = booking('2027-05-16', '22:00', '01:00', 'weekly_cap', { dish: 'something-new' });
    expect(
      canLock(input({ request: sn, target: at('2027-05-17', '19:00', '22:00'), bookings: [sunLate] })).ok,
    ).toBe(true);
    expect(
      canLock(input({ request: sn, target: at('2027-05-10', '19:00', '22:00'), bookings: [sunLate] })),
    ).toEqual({
      ok: false,
      reason: 'week_full',
    });
  });
});

describe('CR-05 rule 2(i): a guest is never locked into a window the dish does not use', () => {
  const evening = { slot: slot(base, '2027-05-13', 'evening') };
  const as = (dish: string) => ({
    request: { id: 'me', status: 'requested' as const, countsToward: 'weekly_cap' as const, dish },
  });
  it('with windowRule: a lunch dish on an evening, an evening dish on a lunch and a dates-only dish are refused', () => {
    const refused = { ok: false, reason: 'not_for_this_dish' };
    expect(canLock(input({ ...as('the-long-lunch'), target: evening, windowRule: true }))).toEqual(refused);
    expect(canLock(input({ ...as('the-first-round'), windowRule: true }))).toEqual(refused); // the lunch
    expect(canLock(input({ ...as('the-encore'), windowRule: true }))).toEqual(refused);
    // The dish's own windows pass, and a range (a dates-mode time) is not a window.
    expect(canLock(input({ ...as('the-first-round'), target: evening, windowRule: true })).ok).toBe(true);
    expect(canLock(input({ ...as('surprise-me'), target: evening, windowRule: true })).ok).toBe(true);
    const range = {
      range: {
        startsAt: vancouverInstant('2027-05-15', '10:00'),
        endsAt: vancouverInstant('2027-05-15', '12:00'),
      },
    };
    expect(canLock(input({ ...as('the-encore'), target: range, windowRule: true })).ok).toBe(true);
  });
  it('without it (Jon’s own Lock it in, an Override stand-by offer) the window is his call', () => {
    expect(canLock(input({ ...as('the-long-lunch'), target: evening })).ok).toBe(true);
  });
});

describe('ENG-11 rule 2(e) on any day: a Big Day is the whole day', () => {
  const at = (date: string, from: string, to: string) => ({
    range: { startsAt: vancouverInstant(date, from), endsAt: vancouverInstant(date, to) },
  });
  const as = (countsToward: 'big_day' | 'weekly_cap', dish: string) => ({
    request: { id: 'me', status: 'requested' as const, countsToward, dish },
  });
  const grindSat = booking('2027-05-22', '07:00', '12:00', 'big_day');
  it('a second Big Day on that Saturday, or an Encore on its evening, needs Book anyway', () => {
    const clash = { ok: false, reason: 'big_day_clash' };
    const shoreRide = { ...as('big_day', 'the-shore-ride'), target: at('2027-05-22', '13:00', '18:00') };
    const encore = { ...as('weekly_cap', 'the-encore'), target: at('2027-05-22', '19:30', '23:00') };
    expect(canLock(input({ ...shoreRide, bookings: [grindSat] }))).toEqual(clash);
    expect(canLock(input({ ...encore, bookings: [grindSat] }))).toEqual(clash);
    // And the other way: a Big Day on a Saturday that already has an Encore.
    const encoreBooked = booking('2027-05-22', '19:30', '23:00', 'weekly_cap');
    expect(canLock(input({ ...shoreRide, bookings: [encoreBooked] }))).toEqual(clash);
    // Book anyway goes ahead; another Saturday is free.
    expect(canLock(input({ ...shoreRide, bookings: [grindSat], bookAnyway: true })).ok).toBe(true);
    expect(
      canLock(input({ ...encore, target: at('2027-05-29', '19:30', '23:00'), bookings: [grindSat] })).ok,
    ).toBe(true);
  });
});
