// T2.3.04 input rules: a slot, or a date + start + length (C3 rule 14: never all-day), in Vancouver time.
import { describe, expect, it } from 'vitest';
import { LockBody, targetFrom } from '@/features/requests/lock-api';

const dates = { date: '2027-05-14', start: '09:00', lengthMinutes: 240, countsToward: 'big_day' };

describe('LockBody + targetFrom', () => {
  it('a slot target carries only the slot id and the two ticks (default off)', () => {
    const b = LockBody.parse({ slotId: '00000000-0000-4000-8000-000000000001' });
    expect(b).toEqual({
      slotId: '00000000-0000-4000-8000-000000000001',
      overrideWeek: false,
      bookAnyway: false,
    });
    expect(targetFrom(b)).toEqual({ slotId: '00000000-0000-4000-8000-000000000001' });
  });
  it('dates mode: Vancouver wall clock + length → a concrete range; a blank place is null', () => {
    const t = targetFrom(LockBody.parse({ ...dates, where: '  ', bookAnyway: true }));
    expect(t).toEqual({
      startsAt: new Date('2027-05-14T16:00:00Z'), // PDT = UTC-7
      endsAt: new Date('2027-05-14T20:00:00Z'),
      countsToward: 'big_day',
      where: null,
    });
  });
  it('refuses all-day (no length), zero or huge lengths, bad times, mixed shapes and extra keys', () => {
    for (const bad of [
      { ...dates, lengthMinutes: undefined },
      { ...dates, lengthMinutes: 0 },
      { ...dates, lengthMinutes: 72 * 60 + 1 },
      { ...dates, lengthMinutes: 60.5 },
      { ...dates, start: '24:00' },
      { ...dates, start: '9:00' },
      { ...dates, date: '2027-02-30' },
      { ...dates, countsToward: 'jon_sets' },
      { ...dates, where: 'x'.repeat(201) },
      { ...dates, slotId: '00000000-0000-4000-8000-000000000001' },
      { slotId: 'slot-1' },
      { slotId: '00000000-0000-4000-8000-000000000001', overrideWeek: 'yes' },
    ]) {
      expect(LockBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(LockBody.safeParse({ ...dates, lengthMinutes: 72 * 60 }).success).toBe(true);
  });
  it('a wall-clock time that does not exist in Vancouver (spring forward) is refused', () => {
    expect(targetFrom(LockBody.parse({ ...dates, date: '2026-03-08', start: '02:30' }))).toBeNull();
    expect(targetFrom(LockBody.parse({ ...dates, date: '2026-03-08', start: '03:30' }))).not.toBeNull();
  });
});
