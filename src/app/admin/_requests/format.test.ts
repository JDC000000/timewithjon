// A2/A3 time and wait labels (g1 #3 (a): the 12-hour house style), in Vancouver time whatever the machine's zone.
import { describe, expect, it } from 'vitest';
import { vancouverInstant } from '@/lib/time';
import { ageLabel, clockLabel, rangeLabel, shortDate, whenLabel } from './format';

const at = (d: string, t: string) => vancouverInstant(d, t);

describe('clockLabel', () => {
  it('noon and midnight are words; whole hours drop the minutes', () => {
    expect(clockLabel(at('2027-05-14', '12:00'))).toBe('noon');
    expect(clockLabel(at('2027-05-14', '00:00'))).toBe('midnight');
    expect(clockLabel(at('2027-05-14', '19:00'))).toBe('7 pm');
    expect(clockLabel(at('2027-05-14', '07:00'))).toBe('7 am');
    expect(clockLabel(at('2027-05-14', '10:30'))).toBe('10:30 am');
    expect(clockLabel(at('2027-05-14', '12:30'))).toBe('12:30 pm');
  });
});

describe('rangeLabel / whenLabel', () => {
  it('a lunch is noon–2 pm and an evening is its start', () => {
    expect(whenLabel(at('2027-05-14', '12:00'), at('2027-05-14', '14:00'))).toBe('Fri May 14 · noon–2 pm');
    expect(whenLabel(at('2027-04-16', '19:00'), at('2027-04-16', '22:00'))).toBe('Fri Apr 16 · 7 pm');
  });
  it('another range shares its am/pm once, or names both', () => {
    expect(rangeLabel(at('2027-05-08', '09:00'), at('2027-05-08', '11:00'))).toBe('9–11 am');
    expect(rangeLabel(at('2027-05-08', '10:30'), at('2027-05-08', '13:00'))).toBe('10:30 am–1 pm');
    expect(rangeLabel(at('2027-05-08', '11:00'), at('2027-05-08', '12:00'))).toBe('11 am–noon');
    expect(rangeLabel(at('2027-05-08', '12:00'), at('2027-05-08', '13:30'))).toBe('noon–1:30 pm');
  });
  it('a range of 12 hours or more is shown by its start', () => {
    expect(rangeLabel(at('2027-05-08', '07:00'), at('2027-05-08', '19:00'))).toBe('7 am');
    expect(rangeLabel(at('2027-05-08', '07:00'), at('2027-05-08', '18:59'))).toBe('7 am–6:59 pm');
  });
  it('the day is the Vancouver day, even late in the evening UTC', () => {
    expect(whenLabel(at('2027-06-03', '19:00'), at('2027-06-03', '22:00'))).toBe('Thu Jun 3 · 7 pm');
  });
});

describe('ageLabel', () => {
  const now = new Date('2027-03-03T22:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  it('minutes under an hour, hours under two days, then days', () => {
    expect(ageLabel(ago(0), now)).toBe('0 min');
    expect(ageLabel(ago(59 * 60_000), now)).toBe('59 min');
    expect(ageLabel(ago(60 * 60_000), now)).toBe('1 h');
    expect(ageLabel(ago(26 * 3_600_000), now)).toBe('26 h');
    expect(ageLabel(ago(48 * 3_600_000 - 1), now)).toBe('47 h');
    expect(ageLabel(ago(48 * 3_600_000), now)).toBe('2 d');
    expect(ageLabel(ago(71 * 3_600_000), now)).toBe('2 d');
    expect(ageLabel(ago(72 * 3_600_000), now)).toBe('3 d');
  });
  it('a clock skewed into the future reads as 0 min', () => {
    expect(ageLabel(new Date(now.getTime() + 60_000), now)).toBe('0 min');
  });
});

describe('shortDate', () => {
  it('month and day, Vancouver', () => {
    expect(shortDate(at('2027-04-08', '12:00'))).toBe('Apr 8');
    expect(shortDate(at('2027-03-03', '23:30'))).toBe('Mar 3');
  });
});

describe('ordinal (the override line)', () => {
  it('names the 3rd, 4th, 11th-13th, 21st, 22nd, 101st', async () => {
    const { ordinal } = await import('@/content/ui/admin-requests');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
    ]);
  });
});
