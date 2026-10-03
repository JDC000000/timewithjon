// QA C (M7): every time a guest reads (emails, /manage, /offer) is written the way the site writes it: the picker's
// "Fri May 14 · noon–2 pm" (an evening is its start, "7 pm"), Vancouver time; a guest in another zone also gets theirs.
import { describe, expect, it } from 'vitest';
import { guestWhen } from '@/lib/when';
import { vancouverInstant } from '@/lib/time';

const at = (date: string, time: string) => vancouverInstant(date, time);
const lunch = [at('2027-05-14', '12:00'), at('2027-05-14', '14:00')] as const;
const evening = [at('2027-04-16', '19:00'), at('2027-04-16', '22:00')] as const;

describe('guestWhen (QA C)', () => {
  it('a lunch and an evening read as the picker tiles do', () => {
    expect(guestWhen(...lunch, null)).toBe('Fri May 14 · noon–2 pm');
    expect(guestWhen(...evening, null)).toBe('Fri Apr 16 · 7 pm');
  });

  it('a locked date-based range reads as its hours; a whole day as its start', () => {
    expect(guestWhen(at('2027-04-03', '09:00'), at('2027-04-03', '13:00'), null)).toBe(
      'Sat Apr 3 · 9 am–1 pm',
    );
    expect(guestWhen(at('2027-04-03', '09:00'), at('2027-04-03', '11:30'), null)).toBe(
      'Sat Apr 3 · 9–11:30 am',
    );
    expect(guestWhen(at('2027-04-03', '08:00'), at('2027-04-04', '08:00'), null)).toBe('Sat Apr 3 · 8 am');
  });

  it('Vancouver, an unknown zone or a zone with the same clock: Vancouver only', () => {
    expect(guestWhen(...lunch, 'America/Vancouver')).toBe('Fri May 14 · noon–2 pm');
    expect(guestWhen(...lunch, 'America/Los_Angeles')).toBe('Fri May 14 · noon–2 pm');
    expect(guestWhen(...lunch, 'Not/AZone')).toBe('Fri May 14 · noon–2 pm');
  });

  it('another zone: Vancouver time, then theirs (with the day when it differs)', () => {
    expect(guestWhen(...lunch, 'America/Toronto')).toBe(
      'Fri May 14 · noon–2 pm Vancouver time (3–5 pm your time)',
    );
    expect(guestWhen(...evening, 'Europe/London')).toBe(
      'Fri Apr 16 · 7 pm Vancouver time (Sat Apr 17 · 3 am your time)',
    );
  });

  it('never the 24-hour clock', () => {
    expect(guestWhen(...lunch, 'Australia/Sydney')).not.toMatch(/\d{2}:\d{2}/);
  });
});
