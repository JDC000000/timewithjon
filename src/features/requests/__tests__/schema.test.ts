// M3, M5, L8: the request body refuses repeats and control characters (the route answers 400).
import { describe, expect, it } from 'vitest';
import { RequestBody } from '@/features/requests/schema';

const ok = {
  clientKey: '5f0c1a4e-9a53-4f3e-8f59-0a3c2b1d4e5f', // gitleaks:allow (test fixture)
  dish: 'the-long-lunch',
  name: 'Dave',
  email: 'dave@example.com',
  crew: 1,
};
const issues = (over: Record<string, unknown>) => {
  const r = RequestBody.safeParse({ ...ok, ...over });
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('RequestBody', () => {
  it('accepts a normal body', () => {
    expect(issues({ slotIds: ['a', 'b'] })).toEqual([]);
  });
  it('M3 refuses a repeated slot, L8 a repeated date', () => {
    expect(issues({ slotIds: ['a', 'a'] })).toEqual(['duplicate_slot']);
    expect(issues({ dates: ['2027-05-15', '2027-05-15'] })).toEqual(['duplicate_date']);
  });
  it.each(['name', 'phone', 'windowText', 'guestTimeZone', 'dish', 'overnightNight'])(
    'M5 refuses CR/LF and other control characters in %s',
    (field) => {
      expect(issues({ [field]: 'Dave\r\nBcc: x@evil.example' })).toContain('control_character');
      expect(issues({ [field]: 'a\u0007b' })).toContain('control_character');
      expect(issues({ [field]: 'Dave\u2028Bcc: x' })).toContain('control_character'); // V1
      expect(issues({ [field]: 'Dave\u2029x' })).toContain('control_character'); // V1
    },
  );
  it('M5 multi-line fields keep line breaks but refuse other control characters', () => {
    expect(issues({ note: 'line one\nline two\r\nthree\tok' })).toEqual([]);
    expect(issues({ note: 'bell\u0007' })).toEqual(['control_character']);
  });
  it('06-F overnightNight is one line of at most 60 characters, trimmed', () => {
    expect(issues({ overnight: true, overnightNight: 'x'.repeat(60) })).toEqual([]);
    expect(issues({ overnight: true, overnightNight: 'x'.repeat(61) })).toHaveLength(1);
    expect(RequestBody.parse({ ...ok, overnightNight: '  Sat 15th  ' }).overnightNight).toBe('Sat 15th');
  });
});
