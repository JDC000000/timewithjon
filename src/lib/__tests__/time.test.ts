// src/lib/__tests__/time.test.ts — T0.5 AC13 (helpers) + AC28
import { describe, expect, it } from 'vitest';
import { vancouverInstant, weekStartOf, vancouverDate } from '@/lib/time';
import { guestWhen } from '@/lib/when';
describe('time helpers', () => {
  it('AC28 Toronto guest sees both times (in the site’s style since QA C)', () => {
    const lunch = [vancouverInstant('2027-05-13', '12:00'), vancouverInstant('2027-05-13', '14:00')] as const;
    expect(guestWhen(...lunch, 'America/Toronto')).toBe(
      'Thu May 13 · noon–2 pm Vancouver time (3–5 pm your time)',
    );
    // TSD C5 M2 (EML-01): every guest-facing time says "Vancouver time", even when the guest's clock is the same.
    expect(guestWhen(...lunch, 'America/Vancouver')).toBe('Thu May 13 · noon–2 pm Vancouver time');
    expect(guestWhen(...lunch, 'America/Los_Angeles')).toBe('Thu May 13 · noon–2 pm Vancouver time');
  });
  it('week keys come from the local date, never UTC', () => {
    const lateSunday = vancouverInstant('2027-06-27', '23:30'); // Monday in UTC
    expect(vancouverDate(lateSunday)).toBe('2027-06-27');
    expect(weekStartOf(vancouverDate(lateSunday))).toBe('2027-06-21');
  });
});
