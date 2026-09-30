// U5 (A3): why a picked time is gone, rule by rule, and it always agrees with the C3 engine's isSlotOpen.
import { describe, expect, it } from 'vitest';
import { baseInput, booking, slot } from '@/features/availability/fixtures';
import { isSlotOpen } from '@/features/availability/openWindows';
import { bigDayDates } from '@/features/availability/rules';
import type { EngineInput } from '@/features/availability/types';
import { vancouverInstant } from '@/lib/time';
import { goneReason } from '../times';

const why = (input: EngineInput, date: string, w: 'lunch' | 'evening' = 'lunch') =>
  goneReason(slot(input, date, w), input, bigDayDates(input.bookings));

describe('goneReason', () => {
  it('an open time has no reason', () => {
    expect(why(baseInput(), '2027-05-14')).toBeNull();
  });
  it('past: started, or out of season', () => {
    expect(why(baseInput({ now: vancouverInstant('2027-05-14', '12:00') }), '2027-05-14')).toBe('past');
    const short = baseInput();
    short.settings.seasonEnd = '2027-05-01';
    expect(why(short, '2027-05-14')).toBe('past');
  });
  it('blocked: a block, away, or the household hold', () => {
    const blocks = [
      { startDate: '2027-05-14', endDate: '2027-05-14', kind: 'blocked' as const, confirmBy: null },
    ];
    expect(why(baseInput({ blocks }), '2027-05-14')).toBe('blocked');
    const away = [{ startDate: '2027-05-10', endDate: '2027-05-16', kind: 'away' as const, confirmBy: null }];
    expect(why(baseInput({ blocks: away }), '2027-05-14')).toBe('blocked');
    expect(why(baseInput(), '2027-04-01')).toBe('blocked');
    const released = baseInput();
    released.settings.householdHoldReleased = true;
    expect(why(released, '2027-04-01')).toBeNull();
  });
  it('taken: another booking, a Big Day that day, or a live stand-by offer', () => {
    expect(
      why(baseInput({ bookings: [booking('2027-05-14', '12:00', '14:00', 'weekly_cap')] }), '2027-05-14'),
    ).toBe('taken');
    expect(
      why(
        baseInput({ bookings: [booking('2027-05-14', '07:00', '09:00', 'big_day')] }),
        '2027-05-14',
        'evening',
      ),
    ).toBe('taken');
    const offer = {
      id: 'o1',
      requestId: 'other',
      kind: 'standby_open' as const,
      slotIds: ['2027-05-14-lunch'],
      ranges: [],
      expiresAt: null,
      takenAt: null,
      releasedAt: null,
    };
    expect(why(baseInput({ offers: [offer] }), '2027-05-14')).toBe('taken');
  });
  it('busy on Jon’s calendar, then a full week, then a window the dish doesn’t use', () => {
    const busy = [
      { start: vancouverInstant('2027-05-14', '13:00'), end: vancouverInstant('2027-05-14', '13:30') },
    ];
    expect(why(baseInput({ busy }), '2027-05-14')).toBe('busy');
    const full = baseInput({
      bookings: [
        booking('2027-05-13', '12:00', '14:00', 'weekly_cap'),
        booking('2027-05-13', '19:00', '22:00', 'weekly_cap'),
      ],
    });
    expect(why(full, '2027-05-14')).toBe('week_full');
    expect(why(baseInput({ dishWindows: ['evening'] }), '2027-05-14')).toBe('window');
  });
  // 52 slots x 2 engine walks: seconds on a busy shared box (pr39 F7), so its own budget.
  it('agrees with isSlotOpen on every slot of a busy season', { timeout: 30_000 }, () => {
    const input = baseInput({
      now: vancouverInstant('2027-04-20', '09:00'),
      blocks: [{ startDate: '2027-05-06', endDate: '2027-05-07', kind: 'blocked', confirmBy: null }],
      bookings: [
        booking('2027-05-13', '12:00', '14:00', 'weekly_cap'),
        booking('2027-05-13', '19:00', '22:00', 'weekly_cap'),
        booking('2027-05-22', '07:00', '17:00', 'big_day'),
        booking('2027-06-03', '12:00', '14:00', 'weekly_cap'),
      ],
      busy: [
        { start: vancouverInstant('2027-06-10', '18:00'), end: vancouverInstant('2027-06-10', '23:00') },
      ],
      dishWindows: ['lunch'],
    });
    const bigDays = bigDayDates(input.bookings);
    for (const s of input.slots) {
      expect(goneReason(s, input, bigDays) === null, s.id).toBe(isSlotOpen(s, input, bigDays));
    }
  });
});
