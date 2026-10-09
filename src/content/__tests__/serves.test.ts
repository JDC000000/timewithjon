// Q9: the crew stepper's range comes from servesMin/servesMax, and guests read the same number on the menu card
// ("serves 1–3", "serves up to 15", "serves 4"). This keeps the data and the words in step: an exact "serves N" is a
// fixed size (min = max = N), "serves a–b" starts at a, "up to N" starts at 1, and a dish whose card names no head
// count serves one (The Long Distance) or keeps its own reason in menu.ts (The Family Hang's "3 families").
import { describe, expect, it } from 'vitest';
import { DISHES } from '@/content';
import { crewRange } from '@/content/menu-helpers';

describe('the menu card says what the crew stepper offers', () => {
  it.each(DISHES.map((d) => [d.slug, d] as const))('%s', (_slug, d) => {
    const range = crewRange(d);
    const upTo = /serves up to (\d+)(?! families)/.exec(d.detail);
    const span = /serves (\d+)–(\d+)/.exec(d.detail);
    const exact = /serves (\d+)(?![–\d])(?! families)/.exec(d.detail);
    if (upTo) expect(range).toEqual({ min: 1, max: Number(upTo[1]) });
    else if (span) expect(range).toEqual({ min: Number(span[1]), max: Number(span[2]) });
    else if (exact) expect(range).toEqual({ min: Number(exact[1]), max: Number(exact[1]) });
    else if (/families/.test(d.detail)) expect(range).toEqual({ min: 1, max: 15 });
    else expect(range).toEqual({ min: 1, max: 1 });
  });

  it('pins the fixed and the single-person dishes', () => {
    const bySlug = (s: string) => crewRange(DISHES.find((d) => d.slug === s)!);
    expect(bySlug('the-double-date')).toEqual({ min: 4, max: 4 });
    expect(bySlug('the-long-distance')).toEqual({ min: 1, max: 1 });
    expect(bySlug('the-flat-white')).toEqual({ min: 1, max: 3 });
    expect(Math.max(...DISHES.map((d) => crewRange(d).max))).toBeLessThan(16); // a guest's crew is never "big"
  });
});
