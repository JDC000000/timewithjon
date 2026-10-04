// QA r2 M3 + L6: dates-mode dishes in the C3 engine. M3: a week's stand-by state for a date dish comes from its
// dates (rule 10 by date), not from Thu/Fri time slots it never uses. L6: the household hold (Thu Apr 1 lunch,
// rule 2(c)) is off the date grid (rule 11) and a range lock over it needs "Book anyway" (rule 8), as a block does.
import { describe, expect, it } from 'vitest';
import { canLock, dateWeekStatus, unavailableDates, type CanLockInput } from '@/features/availability';
import { baseInput, booking, slot } from '@/features/availability/fixtures';
import { dateRuleAllows } from '@/features/availability/rules';
import { vancouverInstant } from '@/lib/time';

const GRIND = { countsToward: 'big_day' as const, dateRule: 'weekend-or-thu-fri' as const };
const state = (week: string, over: Parameters<typeof baseInput>[0] = {}) =>
  dateWeekStatus(week, baseInput({ dishWindows: [], ...over }), GRIND);

describe('dateWeekStatus (QA r2 M3)', () => {
  it('a free week is open, though a date dish has no time slots', () => {
    expect(state('2027-05-31')).toBe('open');
    expect(state('2027-04-26')).toBe('open');
  });

  it('spoken for only when no date the dish allows is left (Thu/Fri taken, weekend Big Days)', () => {
    const bookings = [
      booking('2027-05-13', '12:00', '14:00', 'weekly_cap'),
      booking('2027-05-14', '19:00', '22:00', 'weekly_cap'),
      booking('2027-05-15', '09:00', '15:00', 'big_day'),
    ];
    expect(state('2027-05-10', { bookings })).toBe('open'); // Sun May 16 is still free
    const full = [...bookings, booking('2027-05-16', '09:00', '15:00', 'big_day')];
    expect(state('2027-05-10', { bookings: full })).toBe('spoken_for');
  });

  it('away when Jon is away all week; closed before booking opens', () => {
    const away = {
      startDate: '2027-05-03',
      endDate: '2027-05-09',
      kind: 'away' as const,
      confirmBy: '2027-05-12',
    };
    expect(state('2027-05-03', { blocks: [away] })).toBe('away');
    expect(state('2027-05-03', { now: new Date('2027-01-01T00:00:00Z') })).toBe('closed');
  });

  it('a past week or a week outside the season has nothing left to offer', () => {
    expect(state('2027-05-03', { now: new Date('2027-05-10T18:00:00Z') })).toBe('spoken_for');
    expect(state('2027-07-05')).toBe('spoken_for');
  });

  it('the date rule is the same one the grid and the server use', () => {
    expect(
      ['2027-05-12', '2027-05-13', '2027-05-16'].map((d) => dateRuleAllows('weekend-or-thu-fri', d)),
    ).toEqual([false, true, true]);
    expect(dateRuleAllows('weekend', '2027-05-14')).toBe(false);
    expect(dateRuleAllows(null, '2027-05-12')).toBe(true);
  });
});

describe('the household hold on date dishes (QA r2 L6)', () => {
  it('Thu Apr 1 is off the date grid until Jon releases the hold', () => {
    expect(unavailableDates(baseInput())).toContain('2027-04-01');
    expect(unavailableDates(baseInput())).not.toContain('2027-04-02');
    const released = baseInput();
    released.settings = { ...released.settings, householdHoldReleased: true };
    expect(unavailableDates(released)).not.toContain('2027-04-01');
  });

  const base = baseInput();
  const lock = (over: Partial<CanLockInput>): CanLockInput => ({
    now: base.now,
    request: { id: 'me', status: 'requested', countsToward: 'big_day', dish: 'the-grind' },
    mode: 'lock',
    target: {
      range: {
        startsAt: vancouverInstant('2027-04-01', '12:00'),
        endsAt: vancouverInstant('2027-04-01', '16:00'),
      },
    },
    bookings: [],
    blocks: [],
    weeks: base.weeks,
    offers: [],
    settings: base.settings,
    ...over,
  });

  it('a range over the hold is blocked; Book anyway or a released hold lets it through', () => {
    expect(canLock(lock({}))).toEqual({ ok: false, reason: 'blocked' });
    expect(canLock(lock({ bookAnyway: true })).ok).toBe(true);
    expect(canLock(lock({ settings: { ...base.settings, householdHoldReleased: true } })).ok).toBe(true);
  });

  it('the hold is lunch only: an Apr 1 evening range or another day is not held', () => {
    const evening = {
      startsAt: vancouverInstant('2027-04-01', '19:30'),
      endsAt: vancouverInstant('2027-04-01', '23:00'),
    };
    expect(canLock(lock({ target: { range: evening } })).ok).toBe(true);
    expect(canLock(lock({ target: { slot: slot(base, '2027-04-01', 'evening') } })).ok).toBe(true);
    expect(canLock(lock({ target: { slot: slot(base, '2027-04-01', 'lunch') } }))).toEqual({
      ok: false,
      reason: 'blocked',
    });
  });
});
