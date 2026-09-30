// src/lib/__tests__/time.test.ts — T0.5 AC13 (helpers) + AC28
import { describe, expect, it } from 'vitest';
import { formatGuestTime, vancouverInstant, weekStartOf, vancouverDate } from '@/lib/time';
describe('time helpers', () => {
  it('AC28 Toronto guest sees both times', () => {
    expect(formatGuestTime(vancouverInstant('2027-05-13', '12:00'), 'America/Toronto')).toBe(
      '12:00 Vancouver time (3:00 pm your time)',
    );
    expect(formatGuestTime(vancouverInstant('2027-05-13', '12:00'), 'America/Vancouver')).toBe(
      '12:00 Vancouver time',
    );
    expect(formatGuestTime(vancouverInstant('2027-05-13', '12:00'), 'America/Los_Angeles')).toBe(
      '12:00 Vancouver time',
    );
  });
  it('week keys come from the local date, never UTC', () => {
    const lateSunday = vancouverInstant('2027-06-27', '23:30'); // Monday in UTC
    expect(vancouverDate(lateSunday)).toBe('2027-06-27');
    expect(weekStartOf(vancouverDate(lateSunday))).toBe('2027-06-21');
  });
});
