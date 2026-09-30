// src/features/invites/our-things.ts — TSD v1.8 "our things": 0-3 phrases (blank = '{}', the open-link line).
// Each phrase: 1-40 characters (code points), 1-4 words separated by plain spaces, no leading/trailing space,
// no commas (the hero line joins phrases with ", "), and no control or non-space whitespace characters
// (tabs, newlines, NBSP...). The DB check our_things_ok() (migration 3) enforces the IDENTICAL rule;
// tests/fixtures/our-things-cases.ts runs the same case table against both.
import { z } from 'zod';

export const OUR_THINGS_MAX = 3;
const MAX_CHARS = 40;
const MAX_WORDS = 4;
// Mirrored character-for-character in our_things_ok(). \u0000 is omitted there only because Postgres text can't hold it.
const FORBIDDEN =
  /[,\u0000-\u001F\u007F-\u009F\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/u;

export type OurThingError =
  'thing_empty' | 'thing_too_long' | 'no_commas' | 'bad_character' | 'four_words_max';

/** Validates one already-normalised phrase. Returns null when valid. */
export function ourThingError(s: string): OurThingError | null {
  const chars = [...s].length;
  if (chars === 0) return 'thing_empty';
  if (chars > MAX_CHARS) return 'thing_too_long';
  if (s.includes(',')) return 'no_commas';
  if (FORBIDDEN.test(s) || /^ | $/.test(s)) return 'bad_character';
  if (s.split(/ +/).length > MAX_WORDS) return 'four_words_max';
  return null;
}

/** Only plain spaces are trimmed; a tab or newline anywhere is refused, not silently removed. */
const trimSpaces = (s: string) => s.replace(/^ +| +$/g, '');

export const OurThing = z
  .string()
  .transform(trimSpaces)
  .superRefine((s, ctx) => {
    const error = ourThingError(s);
    if (error) ctx.addIssue({ code: 'custom', message: error });
  });

/** Blank entries (admin form fields left empty) are dropped; all blank -> [] (stored as '{}'). */
export const OurThings = z
  .array(z.string())
  .transform((a) => a.map(trimSpaces).filter((s) => s.length > 0))
  .pipe(z.array(OurThing).max(OUR_THINGS_MAX, 'three_max'));
