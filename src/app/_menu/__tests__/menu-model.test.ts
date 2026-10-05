// S04 /menu view model + deep links (pack v2.2 s04/s05): course order, rows, sheets, photo slots. Jon (2026-10-05):
// the Bluebird is off the menu and the menu foot is gone.
import { describe, expect, it } from 'vitest';
import { DISHES, DISH_CARDS, menuLine, type Dish } from '@/content';
import { dishBySlug } from '@/content/menu-helpers';
import { PHOTO_SLOTS } from '@/ui/photo-slots';
import { menuModel } from '../menu-model';
import { opensSheet, slugFromHash } from '../sheet-open';

const NOW = new Date('2027-03-01T12:00:00Z');
const m = menuModel(NOW);
const rows = m.courses.flatMap((c) => c.dishes);
const row = (slug: string) => rows.find((d) => d.slug === slug)!;

describe('menuModel (S04)', () => {
  it('four courses in pack order, with the Big Days note', () => {
    expect(m.courses.map((c) => [c.id, c.title, c.intro])).toEqual([
      ['starters', 'Starters', null],
      ['mains', 'Mains', null],
      ['big-days', 'Big Days', 'Weekends are fine. Pick a date, and I’ll confirm.'],
      ['off-the-menu', 'Off the Menu', null],
    ]);
  });
  it('all 15 activities in menu order; Mains ends The Encore, The Double Date, The Family Hang', () => {
    expect(rows.map((d) => d.name)).toEqual(DISHES.map((d) => d.name));
    expect(rows).toHaveLength(15);
    expect(m.courses[1]!.dishes.map((d) => d.name)).toEqual([
      'The Long Lunch',
      'The Old Haunt',
      'The Encore',
      'The Double Date',
      'The Family Hang',
    ]);
  });
  it('a bookable row links to /book/{slug} and carries its sheet: course cap, facts, next, Book {dish}', () => {
    expect(row('the-long-lunch')).toEqual({
      slug: 'the-long-lunch',
      name: 'The Long Lunch',
      line: dishBySlug('the-long-lunch')!.line,
      slot: 'long-lunch',
      detail: ['2 hr · Thu/Fri, noon–2 pm', 'serves 1–15 (my wallet prefers 1–6)'],
      href: '/book/the-long-lunch',
      sheet: {
        cap: 'Mains',
        facts: DISH_CARDS['the-long-lunch'].facts,
        next: 'Pick a few times. I’ll lock one in within two days.',
        book: { label: 'Book The Long Lunch', href: '/book/the-long-lunch' },
      },
    });
    expect(row('the-shore-ride').sheet?.cap).toBe('Big Days');
    expect(row('surprise-me').sheet?.cap).toBe('Off the Menu');
  });
  it('the Bluebird is not on the menu at all, and every row is bookable (Jon, 2026-10-05)', () => {
    expect(rows.map((d) => d.slug as string)).not.toContain('the-bluebird');
    expect(rows.filter((d) => d.href === null)).toEqual([]);
    expect(row('the-grind').name).toBe('A hike or nature moment');
    expect(row('the-grind').sheet?.book.label).toBe('Book a hike or nature moment'); // inside a sentence: lowercase
  });
  it('Pitch Me shows its lead and examples in the line', () => {
    expect(row('pitch-me').line).toBe(
      'Got a better idea? If it fits in a day, or one night away, it’s probably a yes. You choose. Cook a dish. ' +
        'Try something new. Do watercolours together. Build something. A night by a campfire. Or take me to the thing you’re best at.',
    );
    expect(menuLine({ line: 'A.' })).toBe('A.');
  });
  it('drops a dish past its last day, and a course left empty', () => {
    const past = { ...dishBySlug('the-flat-white')!, availableUntil: '2027-02-01' } as Dish;
    const only = menuModel(NOW, [past, dishBySlug('the-encore')!]);
    expect(only.courses.map((c) => c.id)).toEqual(['starters', 'mains']);
    expect(only.courses[0]!.dishes[0]).toMatchObject({ href: null, sheet: null });
    expect(menuModel(NOW, [dishBySlug('the-encore')!]).courses.map((c) => c.id)).toEqual(['mains']);
    expect(menuModel(NOW, []).courses).toEqual([]);
  });
  it('has no menu foot any more (Jon, 2026-10-05)', () => {
    expect('foot' in m).toBe(false);
  });
  it('photos = every dish slot in page order, then close; every one filled (a credited stand-in or Jon’s own, dec 48)', () => {
    expect(m.photos).toEqual([...DISHES.map((d) => DISH_CARDS[d.slug].slot), 'close']);
    expect(new Set(m.photos).size).toBe(16);
    for (const s of m.photos) expect(PHOTO_SLOTS[s]?.w.length, s).toBeGreaterThan(0);
  });
});

describe('sheet-open', () => {
  const click = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };
  it('a plain primary click opens the sheet; any modifier, another button or a handled click follows the link', () => {
    expect(opensSheet(click)).toBe(true);
    for (const k of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey', 'defaultPrevented'] as const)
      expect(opensSheet({ ...click, [k]: true }), k).toBe(false);
    expect(opensSheet({ ...click, button: 1 })).toBe(false);
  });
  it('#<slug> of a dish with a sheet opens it; a course, junk or a bad escape opens nothing', () => {
    const slugs = ['the-long-lunch', 'pitch-me'] as const;
    expect(slugFromHash('#the-long-lunch', slugs)).toBe('the-long-lunch');
    expect(slugFromHash('#pitch%2Dme', slugs)).toBe('pitch-me');
    expect(slugFromHash('the-long-lunch', slugs)).toBe('the-long-lunch');
    expect(slugFromHash('#big-days', slugs)).toBeNull();
    expect(slugFromHash('', slugs)).toBeNull();
    expect(slugFromHash('#x-the-long-lunch', slugs)).toBeNull();
    expect(slugFromHash('#%E0%A4%A', slugs)).toBeNull();
  });
});
