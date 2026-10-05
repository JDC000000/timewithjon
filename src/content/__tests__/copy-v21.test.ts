// src/content/__tests__/copy-v21.test.ts — Jon decision 37 (v2.1 copy freeze, design pack v21-copy.md):
// guests see "The Activity Menu" and "activity", never "The Menu" or "dish"; the 2 new items exist word for word.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as content from '@/content';
import { DISHES, EMAIL_COPY, JON_FACING, type TemplateId } from '@/content';
import * as booking from '@/content/ui/booking';
import * as foundation from '@/content/ui/foundation';
import { LOCK_DEFAULTS } from '@/content/ui/admin-requests';

// Machine keys (enums, slugs) are data, not copy.
const DATA_KEYS = new Set([
  'slug',
  'section',
  'mode',
  'flow',
  'windows',
  'countsToward',
  'datesCountToward',
  'dateRule',
  'id',
  'availableUntil',
  'JON_FACING',
]);
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'function') {
    const fn = v as (...a: unknown[]) => unknown;
    const r = fn.toString().includes('things') ? fn(['X', 'Y']) : fn('X', 'Y');
    if (typeof r === 'string') out.push(r);
  } else if (v && typeof v === 'object')
    Object.entries(v).forEach(([k, x]) => {
      if (!DATA_KEYS.has(k)) strings(x, out);
    });
  return out;
}

/** Every guest-facing copy string: src/content minus Jon-facing mail and admin copy, plus the guest UI modules. */
const without = (mod: object, keys: string[]) =>
  Object.fromEntries(Object.entries(mod).filter(([k]) => !keys.includes(k)));
function guestStrings(): string[] {
  const guestMail = Object.fromEntries(
    Object.entries(EMAIL_COPY).filter(([id]) => !JON_FACING.includes(id as TemplateId)),
  );
  return [
    ...strings(without(content, ['EMAIL_COPY', 'ADMIN_SIGN_IN_EMAIL'])),
    ...strings(guestMail),
    ...strings(booking),
    ...strings(without(foundation, ['ADMIN_SHELL'])),
  ];
}

/** A {placeholder} is a variable (the activity's name), not copy. Jon's "Cook a dish." is food you cook (decision 43(7)). */
const ALLOWED_DISH = /Cook a dish\./g;
function copyViolations(all: readonly string[]): string[] {
  return all.flatMap((raw) => {
    const s = raw.replace(/\{\w+\}/g, '').replace(ALLOWED_DISH, '');
    const hits: string[] = [];
    if (/\bdish(es)?\b/i.test(s)) hits.push(`dish :: ${raw}`);
    if (/\bThe Menu\b/.test(s)) hits.push(`The Menu :: ${raw}`);
    if (/\b(see|back to) the (whole )?menu\b/i.test(s)) hits.push(`menu link :: ${raw}`);
    return hits;
  });
}

describe('v2.1 copy guard (decision 37)', () => {
  it('the guard catches a planted fault (so a pass means something)', () => {
    expect(copyViolations(['Pick a dish.'])).toHaveLength(1);
    expect(copyViolations(['Two dishes'])).toHaveLength(1);
    expect(copyViolations(['The Menu'])).toHaveLength(1);
    expect(copyViolations(['Back to the menu'])).toHaveLength(1);
    expect(copyViolations(['See the whole menu'])).toHaveLength(1);
    expect(copyViolations(['Cook a dish. And another dish.'])).toHaveLength(1);
    expect(copyViolations(['Teach me a dish.'])).toHaveLength(1); // retired by decision 43(7)
    expect(
      copyViolations([
        'The Activity Menu',
        'Got it: {dish}',
        'Cook a dish.',
        'Pick something off the menu.',
        'Off the Menu',
        'See the activity menu',
      ]),
    ).toEqual([]);
  });

  it('no guest-facing string says "dish", "The Menu", "See the menu" or "Back to the menu"', () => {
    const all = guestStrings();
    expect(all.length).toBeGreaterThan(100);
    expect(copyViolations(all)).toEqual([]);
  });

  it('the guest mail E1 / E4 / E7 subjects and bodies name no dish and no menu', () => {
    for (const id of ['E1', 'E4', 'E7'] as const) {
      const { subject, body } = EMAIL_COPY[id];
      expect(copyViolations([subject, body]), id).toEqual([]);
      expect(`${subject}\n${body}`.replace(/\{\w+\}/g, '')).not.toMatch(/\bmenu\b/i);
    }
  });

  it('the v2.1 strings, word for word', () => {
    expect(content.OPEN_LINE).toBe(
      'We keep saying we should get or do that epic trip.', // Jon, 2026-10-05: one line for everyone
    );
    expect(content.SEE_THE_MENU).toBe('See the activity menu');
    expect(content.PERSONAL.seeWholeMenu).toBe('See the whole activity menu');
    expect(content.NOT_FOUND.back).toBe('Back to the activity menu');
    expect(content.MENU_TITLE).toBe('The Activity Menu');
    // Jon (2026-10-05): the subhead's new end, and the menu foot is gone.
    expect(content.MENU_SUBHEAD).toBe(
      'Pick an activity. Tell me when works. I’ll lock one in and looking forward to seeing you.',
    );
    expect('MENU_FOOTER' in content).toBe(false);
    expect(foundation.SITE_NAV.menu).toBe('The Activity Menu');
    expect(booking.FLOW_UI.backToMenu).toBe('The Activity Menu');
    expect(booking.RAIL.otherDish).toBe('Pick a different activity');
    // Decision 43(7) replaced "Teach me a dish." (copy-v22.test.ts has the new lines).
    expect(DISHES.find((d) => d.slug === 'pitch-me')?.suggestions).not.toContain('Teach me a dish.');
  });

  it('the page meta description is the landing opener (no stale copy in the layout)', () => {
    const layout = readFileSync(path.resolve(__dirname, '../../app/layout.tsx'), 'utf8');
    expect(layout).toContain('description: `${OPEN_LINE} ${HEADLINE}`');
  });

  it('no retired guest phrase is left anywhere in src (outside tests and admin)', () => {
    const RETIRED = [
      /Fromme lap/,
      /Pick a dish/,
      /Teach me a dish/, // decision 43(7)
      /different dish/,
      /See the menu/,
      /Back to the menu/,
      /\bThe Menu\b/, // case-sensitive: the course "Off the Menu" stays allowed
    ];
    // JSX text naming a dish, in a component (.tsx only; code characters excluded so `=>`, generics and
    // `dish.flow` between two tags are not mistaken for text).
    const JSX_DISH = />[^<>{}();=]*\bdish(es)?\b[^<>{}();=]*</;
    const hits: string[] = [];
    const walk = (dir: string) =>
      readdirSync(dir).forEach((f) => {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) {
          if (!/^(__tests__|admin)$/.test(f)) walk(p);
        } else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) {
          const src = readFileSync(p, 'utf8');
          RETIRED.filter((re) => re.test(src)).forEach((re) => hits.push(`${re} :: ${p}`));
          if (f.endsWith('.tsx') && JSX_DISH.test(src)) hits.push(`${JSX_DISH} :: ${p}`);
        }
      });
    walk(path.resolve(__dirname, '../..'));
    expect(hits).toEqual([]);
  });
});

describe('v2.1 new menu items (decision 37f, NEW COPY)', () => {
  const DAY_TRIP = {
    slug: 'the-day-trip',
    section: 'big-days',
    name: 'The Day Trip',
    line: 'Pick somewhere an hour or two up the road. I’ll drive. You’re in charge of snacks.',
    detail: 'a day · home by dark · one car · serves up to 4',
    mode: 'dates',
    flow: 'dates',
    windows: [],
    countsToward: 'big_day',
    dateRule: 'weekend-or-thu-fri',
    overnightAllowed: false,
    servesMax: 4,
    bookable: true,
    availableUntil: null,
  };
  const SOMETHING_NEW = {
    slug: 'something-new',
    section: 'off-the-menu',
    name: 'Something New',
    line: 'Something neither of us has tried. Pottery, axe throwing, a cold plunge. We’ll both be bad at it, which is the fun part.',
    detail: 'an evening or half a day · serves up to 6',
    mode: 'dates',
    flow: 'dates',
    windows: [],
    countsToward: 'weekly_cap',
    dateRule: 'any-day',
    overnightAllowed: false,
    servesMax: 6,
    bookable: true,
    availableUntil: null,
    maxPerWeek: 1, // decision 43(4)
  };

  it('both exist with every field', () => {
    expect(DISHES.find((d) => d.slug === 'the-day-trip')).toEqual(DAY_TRIP);
    expect(DISHES.find((d) => d.slug === 'something-new')).toEqual(SOMETHING_NEW);
  });

  it('The Day Trip sits after the hike (the-grind) and ends the Big Days (the Bluebird is gone); Something New after Pitch Me', () => {
    const slugs = DISHES.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length); // the count itself: copy-v22.test.ts
    expect(slugs.slice(slugs.indexOf('the-grind'), slugs.indexOf('the-grind') + 3)).toEqual([
      'the-grind',
      'the-day-trip',
      'surprise-me',
    ]);
    expect(slugs.slice(-2)).toEqual(['pitch-me', 'something-new']);
  });

  it('lock-in defaults: The Day Trip 9 am, a day (decision 43(5)); Something New "any other" (decision 39)', () => {
    expect(LOCK_DEFAULTS.byDish['the-day-trip']).toEqual({ start: '09:00', minutes: 480 });
    expect(LOCK_DEFAULTS.byDish['something-new']).toBeUndefined();
    expect(LOCK_DEFAULTS.fallback).toEqual({ start: '09:00', minutes: 120 });
  });
});
