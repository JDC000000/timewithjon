// T3.8.03: a honeypot counts as filled only with visible content (autofill of blanks is not spam).
import { describe, expect, it } from 'vitest';
import { honeypotField, isHoneypotFilled } from '@/lib/honeypot';

describe('honeypot', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['   \n', false],
    ['x', true],
    [' http://spam.example ', true],
  ])('%j filled = %s', (v, filled) => expect(isHoneypotFilled(v)).toBe(filled));
  it('an oversize or non-string value is never refused: it parses as filled (review F2)', () => {
    expect(honeypotField.parse('a'.repeat(200))).toBe('a'.repeat(200));
    for (const v of ['a'.repeat(201), 42, { x: 1 }]) {
      const parsed = honeypotField.parse(v);
      expect(parsed).toBe('overflow');
      expect(isHoneypotFilled(parsed)).toBe(true);
    }
    expect(honeypotField.parse(undefined)).toBeUndefined();
  });
});
