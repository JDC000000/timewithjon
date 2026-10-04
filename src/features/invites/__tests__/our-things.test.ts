// TSD v1.8: "our things" validation + the hero sentence (creative v1.4 §2.3).
import { describe, expect, it } from 'vitest';
import { OPEN_LINE, PERSONAL } from '@/content/site';
import { OurThings, ourThingError } from '@/features/invites/our-things';
import { ARRAY_CASES, PHRASE_CASES } from '../../../../tests/fixtures/our-things-cases';

describe('our things', () => {
  it.each(PHRASE_CASES)('phrase rule: $label -> ok=$ok (same table as the SQL check)', ({ phrase, ok }) => {
    expect(ourThingError(phrase) === null).toBe(ok);
  });
  it.each(ARRAY_CASES)('array rule: $label -> ok=$ok', ({ things, ok }) => {
    expect(OurThings.safeParse(things).success).toBe(ok);
  });
  it('names the comma error, and refuses a tab rather than trimming it', () => {
    const r = OurThings.safeParse(['beers, then tacos']);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('no_commas');
    expect(OurThings.safeParse(['\tpad']).success).toBe(false);
  });
  it('accepts 1-3 phrases of 4 words max, trims spaces, and turns blank into []', () => {
    expect(OurThings.parse([' the Seymour lap ', 'Tofino again'])).toEqual([
      'the Seymour lap',
      'Tofino again',
    ]);
    expect(OurThings.parse(['', '  '])).toEqual([]);
    expect(OurThings.parse([])).toEqual([]);
  });
  it('refuses a 5-word phrase, a 41-character phrase and a 4th phrase', () => {
    expect(OurThings.safeParse(['that lunch at Earls again']).success).toBe(false);
    expect(OurThings.safeParse(['x'.repeat(41)]).success).toBe(false);
    expect(OurThings.safeParse(['a', 'b', 'c', 'd']).success).toBe(false);
  });
  it('renders 1, 2 and 3 things, and falls back to the open line when blank', () => {
    expect(PERSONAL.ourThingsLine(['the Seymour lap'])).toBe(
      'We keep saying we should do the Seymour lap or that epic trip.',
    );
    expect(PERSONAL.ourThingsLine(['the Seymour lap', 'Tofino again'])).toBe(
      'We keep saying we should do the Seymour lap, Tofino again or that epic trip.',
    );
    expect(PERSONAL.ourThingsLine(['a', 'b', 'c'])).toBe(
      'We keep saying we should do a, b, c or that epic trip.',
    );
    expect(PERSONAL.ourThingsLine(null)).toBe(OPEN_LINE);
    expect(PERSONAL.ourThingsLine([])).toBe(OPEN_LINE);
  });
  it('QA r2 L5: a thing that is the line’s own "that epic trip", or a repeat, is said once', () => {
    expect(PERSONAL.ourThingsLine(['river days', 'that epic trip'])).toBe(
      'We keep saying we should do river days or that epic trip.',
    );
    expect(PERSONAL.ourThingsLine(['That Epic Trip', 'river days', 'River days'])).toBe(
      'We keep saying we should do river days or that epic trip.',
    );
    expect(PERSONAL.ourThingsLine(['that epic trip'])).toBe('We keep saying we should do that epic trip.');
  });
});
