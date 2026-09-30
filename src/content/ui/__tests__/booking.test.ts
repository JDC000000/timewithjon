import { describe, expect, it } from 'vitest';
import * as booking from '../booking';
import { PICKER, thingsToFix } from '../booking';

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'function') out.push(String((v as (...a: unknown[]) => string)('X', 2)));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

describe('booking copy (lane U3)', () => {
  it('keeps the TSD §9 rules: no banned words, no em-dash, no "!"', () => {
    const banned = [
      /—/,
      /!/,
      /\bjohn\b/i,
      new RegExp(`\\b${['de', 'clin'].join('')}`, 'i'), // spelt in two halves (the repo-wide word check)
      /\bslot/i,
      /availab/i,
      /fully booked/i,
      /sold out/i,
      /schedul/i,
    ];
    // The one real "John": the Newfoundland capital in the Long Distance time zones (wireframe 05-C).
    const hits = strings(booking)
      .flatMap((raw) => [raw.replace('St. John’s (Newfoundland)', 'St. Newfoundland')])
      .flatMap((s) => banned.filter((re) => re.test(s)).map((re) => `${re} :: ${s}`));
    expect(hits).toEqual([]);
  });
  it('uses typographic apostrophes and quotes only (decision 31, PR #70)', () => {
    expect(strings(booking).filter((s) => /['"]/.test(s))).toEqual([]);
  });
  it('counts the error summary the pack way', () => {
    expect([1, 2, 3, 5].map(thingsToFix)).toEqual([
      'One thing to fix',
      'Two things to fix',
      'Three things to fix',
      'Five things to fix',
    ]);
    expect(thingsToFix(7)).toBe('7 things to fix');
  });
  it('counts picks in one and many', () => {
    expect([PICKER.count(1), PICKER.count(2), PICKER.countShort(3)]).toEqual([
      '1 time picked',
      '2 times picked',
      '3 picked',
    ]);
    expect(PICKER.picked('Thu May 6 · noon–2 pm', 1)).toBe('Picked Thu May 6 · noon–2 pm. 1 time picked.');
    expect(PICKER.removed('Fri May 7 · 7 pm', 0)).toBe('Removed Fri May 7 · 7 pm. 0 times picked.');
    expect(PICKER.runCaption('Jun 3–4', 'Jun 17–18')).toBe('Jun 3–4 to Jun 17–18');
    expect(PICKER.standbyFor('Jun 3–4')).toBe('Put me on stand-by for Jun 3–4');
  });
});
