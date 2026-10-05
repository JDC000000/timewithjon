// TSD v1.8: "our things" validation (the API still checks the field). Jon (2026-10-05): the hero sentence no longer
// uses them: the landing shows one line for everyone.
import { describe, expect, it } from 'vitest';
import { OPEN_LINE } from '@/content/site';
import { landingModel } from '@/features/invites/landing-model';
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
  it('the hero line ignores an invite’s things: one line for every personal link, the general link and no link', () => {
    expect(OPEN_LINE).toBe('We keep saying we should get or do that epic trip.');
    const personal = (our_things: string[]) =>
      landingModel({
        state: 'valid',
        invite: {
          id: 'i',
          kind: 'personal',
          is_test: true,
          name_slug: 'dave',
          display_name: 'Dave',
          our_things,
          picked_dish: null,
          prefill_name: null,
          prefill_email: null,
          revoked_at: null,
        },
      }).heroLine;
    expect([personal(['the Seymour lap', 'that epic trip']), personal([])]).toEqual([OPEN_LINE, OPEN_LINE]);
    expect(landingModel({ state: 'none' }).heroLine).toBe(OPEN_LINE);
  });
});
