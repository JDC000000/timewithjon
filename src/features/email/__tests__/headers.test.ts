// V1: a header value is always one line, whatever line-break character arrives.
import { describe, expect, it } from 'vitest';
import { flattenHeader } from '@/features/email/headers';

describe('flattenHeader', () => {
  it.each([
    ['CR LF', 'a\r\nBcc: x'],
    ['LF', 'a\nBcc: x'],
    ['NEL', 'a\u0085Bcc: x'],
    ['LINE SEPARATOR', 'a\u2028Bcc: x'],
    ['PARAGRAPH SEPARATOR', 'a\u2029Bcc: x'],
  ])('flattens %s to one space', (_label, value) => {
    expect(flattenHeader(value)).toBe('a Bcc: x');
  });
  it('leaves a normal subject alone', () => {
    expect(flattenHeader('New request: The Long Lunch from Dave')).toBe(
      'New request: The Long Lunch from Dave',
    );
  });
});
