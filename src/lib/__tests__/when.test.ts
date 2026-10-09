// QA C (M7): every time a guest reads (emails, /manage, /offer) is written the way the site writes it: the picker's
// "Fri May 14 · noon–2 pm" (an evening is its start, "7 pm"), Vancouver time; a guest in another zone also gets theirs.
import { describe, expect, it } from 'vitest';
import { guestAt, guestWhen } from '@/lib/when';
import { vancouverInstant } from '@/lib/time';

const at = (date: string, time: string) => vancouverInstant(date, time);
const lunch = [at('2027-05-14', '12:00'), at('2027-05-14', '14:00')] as const;
const evening = [at('2027-04-16', '19:00'), at('2027-04-16', '22:00')] as const;

describe('guestWhen (QA C)', () => {
  it('a lunch and an evening read as the picker tiles do', () => {
    expect(guestWhen(...lunch, null)).toBe('Fri May 14 · noon–2 pm Vancouver time');
    expect(guestWhen(...evening, null)).toBe('Fri Apr 16 · 7 pm Vancouver time');
  });

  it('a locked date-based range reads as its hours; one into another day as its start AND end (Q11)', () => {
    expect(guestWhen(at('2027-04-03', '09:00'), at('2027-04-03', '13:00'), null)).toBe(
      'Sat Apr 3 · 9 am–1 pm Vancouver time',
    );
    expect(guestWhen(at('2027-04-03', '09:00'), at('2027-04-03', '11:30'), null)).toBe(
      'Sat Apr 3 · 9–11:30 am Vancouver time',
    );
    expect(guestWhen(at('2027-04-03', '08:00'), at('2027-04-04', '08:00'), null)).toBe(
      'Sat Apr 3 · 8 am to Sun 8 am Vancouver time',
    );
    // An overnight in another zone: theirs runs to their own end day too.
    expect(guestWhen(at('2027-06-24', '15:00'), at('2027-06-25', '11:00'), 'America/Toronto')).toBe(
      'Thu Jun 24 · 3 pm to Fri 11 am Vancouver time (6 pm to Fri 2 pm your time)',
    );
  });

  it('guestAt: one moment (E7’s deadline, Q4), Vancouver time, and theirs when it differs', () => {
    expect(guestAt(at('2027-04-03', '09:00'), null)).toBe('Sat Apr 3 · 9 am Vancouver time');
    expect(guestAt(at('2027-04-03', '09:00'), 'America/Toronto')).toBe(
      'Sat Apr 3 · 9 am Vancouver time (noon your time)',
    );
    expect(guestAt(at('2027-04-03', '20:00'), 'Europe/London')).toBe(
      'Sat Apr 3 · 8 pm Vancouver time (Sun Apr 4 · 4 am your time)',
    );
  });

  it('Vancouver, no zone, an unknown zone or a zone with the same clock: "Vancouver time" only (TSD C5 M2, EML-01)', () => {
    for (const zone of ['America/Vancouver', 'America/Los_Angeles', 'Not/AZone', null, undefined, ''])
      expect(guestWhen(...lunch, zone)).toBe('Fri May 14 · noon–2 pm Vancouver time');
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
