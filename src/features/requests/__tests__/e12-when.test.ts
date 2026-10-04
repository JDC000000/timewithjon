// T3.2 (QA round 1 M7): E12, the cancel email to Jon, writes the locked time in the site's 12-hour style
// ("noon–2 pm", "9 am", "1:30 pm"), Vancouver time, across the 2027 DST changes; never a 24-hour clock.
import { describe, expect, it } from 'vitest';
import { E12_PARTS } from '@/content/emails';
import { renderText } from '@/features/email/registry';
import { vancouverInstant } from '@/lib/time';
import { e12When } from '../guest-cancel';

const locked = (date: string, start: string, end: string) => ({
  status: 'locked',
  starts_at: vancouverInstant(date, start),
  ends_at: vancouverInstant(date, end),
});

const e12 = (when: string) =>
  renderText(
    'E12',
    {
      name: 'Sam',
      dish: 'The Long Lunch',
      when,
      standby: 'nobody',
      adminLink: 'https://timewithjon.com/admin',
    },
    { siteUrl: 'https://timewithjon.com' },
  );

describe('E12 {when} (T3.2 M7)', () => {
  it('a lunch reads "noon–2 pm", in the subject and the body', () => {
    const when = e12When(locked('2027-04-02', '12:00', '14:00'))!;
    expect(when).toBe('Fri Apr 2 · noon–2 pm');
    const { subject, text } = e12(when);
    expect(subject).toBe('Cancelled: The Long Lunch, Fri Apr 2 · noon–2 pm');
    expect(text).toContain('Sam cancelled The Long Lunch (Fri Apr 2 · noon–2 pm).');
  });

  it('an evening reads its start, "7 pm"; other ranges read "9 am–1 pm", "1:30–3 pm"', () => {
    expect(e12When(locked('2027-04-16', '19:00', '22:00'))).toBe('Fri Apr 16 · 7 pm');
    expect(e12When(locked('2027-04-03', '09:00', '13:00'))).toBe('Sat Apr 3 · 9 am–1 pm');
    expect(e12When(locked('2027-04-03', '13:30', '15:00'))).toBe('Sat Apr 3 · 1:30–3 pm');
    expect(e12When(locked('2027-04-03', '10:30', '13:30'))).toBe('Sat Apr 3 · 10:30 am–1:30 pm');
  });

  it('holds across the DST changes in America/Vancouver (Mar 14 and Nov 7, 2027)', () => {
    expect(e12When(locked('2027-03-13', '09:00', '13:00'))).toBe('Sat Mar 13 · 9 am–1 pm'); // PST
    expect(e12When(locked('2027-03-14', '09:00', '13:00'))).toBe('Sun Mar 14 · 9 am–1 pm'); // first PDT day
    expect(e12When(locked('2027-03-14', '12:00', '14:00'))).toBe('Sun Mar 14 · noon–2 pm');
    expect(e12When(locked('2027-11-07', '13:30', '15:00'))).toBe('Sun Nov 7 · 1:30–3 pm'); // back to PST
  });

  it('never prints a 24-hour clock', () => {
    for (const [s, e] of [
      ['12:00', '14:00'],
      ['19:00', '22:00'],
      ['13:30', '17:00'],
      ['00:00', '02:00'],
    ] as const) {
      const when = e12When(locked('2027-03-14', s, e))!;
      const { subject, text } = e12(when);
      expect(`${subject}\n${text}`).not.toMatch(/\b\d{2}:\d{2}\b/);
    }
  });

  it('nothing locked: null, so the email keeps "no time locked yet"', () => {
    expect(e12When({ status: 'requested', starts_at: null, ends_at: null })).toBeNull();
    expect(e12When({ status: 'cancelled', starts_at: new Date(), ends_at: new Date() })).toBeNull();
    expect(e12(E12_PARTS.noTime).subject).toBe('Cancelled: The Long Lunch, no time locked yet');
  });
});
