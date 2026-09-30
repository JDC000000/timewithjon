// The landing's text helpers (the pack's no-widow rule; the phrase split behind the S2 dish link).
import { describe, expect, it } from 'vitest';
import { around, noWidow } from '../text';

describe('noWidow', () => {
  it('joins only the last two words with a no-break space', () => {
    expect(noWidow('Any story, any length.')).toBe('Any story, any length.');
    expect(noWidow('It opens on my 51st.')).toBe('It opens on my 51st.');
  });
  it('leaves a single word alone', () => {
    expect(noWidow('Print')).toBe('Print');
  });
});

describe('around', () => {
  it('splits a sentence around the dish name', () => {
    expect(around('I was thinking The Grind, but anything', 'The Grind')).toEqual([
      'I was thinking ',
      ', but anything',
    ]);
  });
  it('is null when the phrase is missing or empty', () => {
    expect(around('I was thinking lunch', 'The Grind')).toBeNull();
    expect(around('abc', '')).toBeNull();
  });
});
