// src/content/__tests__/copy-v22.test.ts — Jon decisions 41d + 43 (v2.2 copy, design pack v22-copy.md,
// COPY FROZEN 2026-09-27 15:18 UTC): Pitch Me's "You choose." examples, the 2 new activities word for word, the
// approved v2.1 calls (Day Trip default, "Back to Thu/Fri times", The Shore Ride).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISHES, SECTIONS } from '@/content';
import { dishBySlug } from '@/content/menu-helpers';
import { OLD_HAUNT } from '@/content/ui/booking';
import { LOCK_DEFAULTS } from '@/content/ui/admin-requests';
import { defaultsFor, lengthWords } from '@/app/admin/_requests/lock-sheet';
import { dishPhotoSlot, dishView } from '@/app/book/[dish]/_lib/flow-view';

/** The card/sheet blurb as the v2.2 pack renders it: the line, then the lead and the examples. */
function blurb(slug: string): string {
  const d = dishBySlug(slug);
  if (!d) throw new Error(`no ${slug}`);
  return [d.line, d.suggestionsLead, ...(d.suggestions ?? [])].filter(Boolean).join(' ');
}

describe('decision 43(7): Pitch Me says "You choose." with Jon’s examples', () => {
  it('the blurb, word for word (v22-copy.md row 43.7)', () => {
    expect(blurb('pitch-me')).toBe(
      'Got a better idea? If it fits in a day, or one night away, it’s probably a yes. You choose. Cook a dish. ' +
        'Try something new. Do watercolours together. Build something. A night by a campfire. ' +
        'Or take me to the thing you’re best at.',
    );
  });
  it('"You choose." is the lead, not a tap-to-add starter; the starters begin with the examples', () => {
    const v = dishView(dishBySlug('pitch-me')!);
    expect(v.suggestionsLead).toBe('You choose.');
    expect(v.suggestions.slice(0, 3)).toEqual([
      'Cook a dish.',
      'Try something new.',
      'Do watercolours together.',
    ]);
    expect(v.suggestions).not.toContain('You choose.');
    expect(v.suggestions).not.toContain('Teach me a dish.');
    expect(dishView(dishBySlug('the-encore')!).suggestionsLead).toBeNull();
  });
  it('Canadian spelling: watercolours, never watercolors', () => {
    const all = JSON.stringify(DISHES);
    expect(all).toContain('watercolours');
    expect(all).not.toMatch(/watercolors/i);
  });
});

describe('decision 41d: The Double Date and The Family Hang (NEW ACTIVITIES, COPY FROZEN)', () => {
  const DOUBLE_DATE = {
    slug: 'the-double-date',
    section: 'mains',
    name: 'The Double Date',
    line: 'Jane Doe and me, you and yours. A table for four and a second bottle nobody planned on.',
    detail: 'an evening · two couples · serves 4',
    mode: 'dates',
    flow: 'dates',
    windows: [],
    countsToward: 'weekly_cap',
    dateRule: 'any-day',
    overnightAllowed: false,
    servesMax: 4,
    servesMin: 4, // Q9: "serves 4" is a fixed size
    bookable: true,
    availableUntil: null,
  };
  const FAMILY_HANG = {
    slug: 'the-family-hang',
    section: 'mains',
    name: 'The Family Hang',
    line: 'Bring everyone: partners, kids, the dog if it behaves. The kids disappear, and the grown-ups finally finish a sentence.',
    detail: 'an afternoon · kids too · serves up to 3 families',
    mode: 'dates',
    flow: 'dates',
    windows: [],
    countsToward: 'weekly_cap',
    dateRule: 'any-day',
    overnightAllowed: false,
    servesMax: 15,
    bookable: true,
    availableUntil: null,
  };

  it('both exist with every field (the card lines "line 1 / line 2" joined with " · ")', () => {
    expect(dishBySlug('the-double-date')).toEqual(DOUBLE_DATE);
    expect(dishBySlug('the-family-hang')).toEqual(FAMILY_HANG);
  });
  it('15 activities: Starters 3 · Mains 5 · Big Days 4 · Off the Menu 3 (the Bluebird gone, 2026-10-05); both in Mains after The Encore', () => {
    expect(DISHES).toHaveLength(15);
    const count = (id: string) => DISHES.filter((d) => d.section === id).length;
    expect(SECTIONS.map((s) => count(s.id))).toEqual([3, 5, 4, 3]);
    expect(DISHES.filter((d) => d.section === 'mains').map((d) => d.slug)).toEqual([
      'the-long-lunch',
      'the-old-haunt',
      'the-encore',
      'the-double-date',
      'the-family-hang',
    ]);
  });
  it('both take the "any other" lock-in default (decision 39) and the date flow with its sheet', () => {
    for (const slug of ['the-double-date', 'the-family-hang']) {
      expect(LOCK_DEFAULTS.byDish[slug]).toBeUndefined();
      expect(defaultsFor(slug)).toEqual(LOCK_DEFAULTS.fallback);
      expect(dishView(dishBySlug(slug)!)).toMatchObject({ flow: 'dates', course: 'Mains' });
    }
  });
  it('their photos use the stand-in slot keys of the v2.2 pack (no private photo in the repo)', () => {
    expect(dishPhotoSlot('the-double-date')).toBe('double-date');
    expect(dishPhotoSlot('the-family-hang')).toBe('family-hang');
  });
});

describe('decision 43: the approved v2.1 calls', () => {
  it('(5) The Day Trip locks in at 9 am for a full day by default', () => {
    expect(defaultsFor('the-day-trip')).toEqual({ start: '09:00', minutes: 480 });
    expect(lengthWords(defaultsFor('the-day-trip').minutes)).toBe('a day');
  });
  it('(4) Something New: at most 1 a week (enforced in canLock); nothing else has a weekly limit', () => {
    expect(DISHES.filter((d) => d.maxPerWeek !== undefined).map((d) => [d.slug, d.maxPerWeek])).toEqual([
      ['something-new', 1],
    ]);
  });
  it('(9) the Old Haunt switch reads "Back to Thu/Fri times"', () => {
    expect(OLD_HAUNT.toTimes).toBe('Back to Thu/Fri times');
  });
  it('(6) the mountain bike lap is The Shore Ride, and no other name for it is on the menu', () => {
    expect(dishBySlug('the-shore-ride')?.name).toBe('The Shore Ride');
    expect(JSON.stringify(DISHES)).not.toMatch(/Fromme|bike ride|bike lap/i);
  });
});

// Jon decisions 45 + 47a (lane U13): "No gifts. Really." leaves the front; ONE P.S. source for S11 and E1.
describe('decision 45: the no-gifts P.S. (v22-copy.md "v2.2b (dec 44-45)")', () => {
  it('NO_GIFTS_PS, word for word, with its "Print the tag" link label', async () => {
    const { NO_GIFTS_PS } = await import('@/content/site');
    expect(NO_GIFTS_PS).toEqual({
      mark: 'P.S.',
      text:
        'No gifts. Really. The one thing I’ll take is a bottle of wine with a letter or an old photo tucked in. ' +
        'Write on the tag when I should open it. Bring it when we meet.',
      printTag: 'Print the tag',
    });
  });
  it('the retired strings are gone from every content module and the nav (the cut line, the kid names, NO_GIFTS)', async () => {
    const content = await import('@/content');
    const site = await import('@/content/site');
    const foundation = await import('@/content/ui/foundation');
    const all = JSON.stringify([content, site, foundation]);
    expect('NO_GIFTS' in site).toBe(false);
    expect(all).not.toMatch(/a bad day|gets their licence|I’ll wait|\[Kid/);
    // the kid names are banned by sha256 of the lowercased word, so the names themselves never sit in this public repo
    const KID_NAMES = new Set([
      '7781113a99f177280ad3e89bcf631f03acb8fa8e626082dd9158eeee0bdd5674',
      '552bdf4bbc9329b555b93e7c9b6a38f36c6edb58b0e7fca0392f79528cc1b9e6',
    ]);
    const words = new Set(all.toLowerCase().match(/[a-z]+/g) ?? []);
    const kidHits = [...words].filter((w) => KID_NAMES.has(createHash('sha256').update(w).digest('hex')));
    expect(kidHits).toEqual([]);
    expect(JSON.stringify(foundation.SITE_NAV)).not.toMatch(/gift/i);
    // as a string or JSX text, "No gifts" is written once in the source: the P.S. (tests and comments aside)
    const hits = sourceFiles(new URL('../../', import.meta.url).pathname).filter((f) =>
      /['"`]No gifts|>\s*No gifts/i.test(readFileSync(f, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')),
    );
    expect(hits.map((f) => f.slice(f.indexOf('src/')))).toEqual(['src/content/site.ts']);
  });
});

/** Every .ts/.tsx under src/, tests excluded. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}
