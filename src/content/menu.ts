// src/content/menu.ts — creative v1.2 §4, word for word (reconciled per TSD §14.2).
import type { Dish, DishSlug, Section } from './types';

// TODO(v2.1 layout): the landing's "April to June 2027 / The Activity Menu" section is removed (decision 37c); the
// activity menu page (S04) shows the name alone. Kept until U2/U4 rebuild the screens.
export const MENU_HEADER = 'The Activity Menu · April to June 2027'; // v2.1 COPY (decision 37d)
/** The activity menu page's name (S04/S05 h1, header nav, back links, <title>): decision 37d. */
export const MENU_TITLE = 'The Activity Menu'; // v2.1 COPY (decision 37d)
export const MENU_SUBHEAD =
  'Pick an activity. Tell me when works. I’ll lock one in, and I’m looking forward to seeing you.'; // approved: Jon (2026-10-05)
export const SECTIONS: { id: Section; title: string; intro?: string }[] = [
  { id: 'starters', title: 'Starters' },
  { id: 'mains', title: 'Mains' },
  { id: 'big-days', title: 'Big Days', intro: 'Weekends are fine. Pick a date, and I’ll confirm.' },
  { id: 'off-the-menu', title: 'Off the Menu' },
];
export const DISHES: Dish[] = [
  {
    slug: 'the-flat-white',
    section: 'starters',
    name: 'The Flat White',
    line: 'Half an hour and a coffee. Good for anyone with a job, a toddler, or both.',
    detail: '30 min · Thu/Fri, noon–2 pm · serves 1–3', // approved: Jon (2026-10-04)
    mode: 'slots',
    flow: 'picker',
    windows: ['lunch'],
    countsToward: 'weekly_cap',
    overnightAllowed: false,
    servesMax: 3,
    bookable: true,
    availableUntil: null,
  },
  {
    slug: 'the-first-round',
    section: 'starters',
    name: 'The First Round',
    line: 'You pick the bar. First round’s mine, second’s yours, and after that nobody’s counting.',
    detail: 'Thu/Fri, from 7 pm · serves up to 15',
    mode: 'slots',
    flow: 'picker',
    windows: ['evening'],
    countsToward: 'weekly_cap',
    overnightAllowed: false,
    servesMax: 15,
    bookable: true,
    availableUntil: null,
  },
  {
    slug: 'the-long-distance',
    section: 'starters',
    name: 'The Long Distance',
    line: 'Not on the North Shore? Call me. Forty-five minutes, your time zone, bring a drink.',
    detail: '45 min · phone or video · any day we both can',
    mode: 'dates',
    flow: 'dates',
    windows: [],
    countsToward: 'none',
    dateRule: 'any-day',
    overnightAllowed: false,
    servesMax: 1,
    bookable: true,
    availableUntil: null,
  },
  {
    slug: 'the-long-lunch',
    section: 'mains',
    name: 'The Long Lunch',
    line: 'You pick the place. I pick up the bill. Order the halibut.',
    detail: '2 hr · Thu/Fri, noon–2 pm · serves 1–15 (my wallet prefers 1–6)', // approved: Jon (2026-10-04)
    mode: 'slots',
    flow: 'picker',
    windows: ['lunch'],
    countsToward: 'weekly_cap',
    overnightAllowed: false,
    servesMax: 15,
    bookable: true,
    availableUntil: null,
  },
  {
    slug: 'the-old-haunt',
    section: 'mains',
    name: 'The Old Haunt',
    line: 'Take me back somewhere. The old school, the first apartment, the bar where we met. You know the one.',
    detail: '2 hr · Thu/Fri or a weekend · serves up to 15',
    mode: 'slots-or-dates',
    flow: 'old-haunt',
    windows: ['lunch', 'evening'],
    countsToward: 'weekly_cap',
    datesCountToward: 'big_day',
    dateRule: 'weekend',
    overnightAllowed: false,
    servesMax: 15,
    bookable: true,
    availableUntil: null,
  },
  {
    slug: 'the-encore',
    section: 'mains',
    name: 'The Encore',
    line: 'You pick the show. I’ll know half the words and sing all of them.',
    detail: 'an evening · serves up to 15',
    mode: 'dates',
    flow: 'dates',
    windows: [],
    countsToward: 'weekly_cap',
    dateRule: 'any-day',
    overnightAllowed: false,
    servesMax: 15,
    bookable: true,
    availableUntil: null,
  },
  {
    // v2.2 (decision 41d): Mains, after The Encore. Copy: design pack v22-copy.md (COPY FROZEN).
    // Lock-in default = "any other" (decision 39). Counted and dated like The Encore (an evening).
    slug: 'the-double-date',
    section: 'mains',
    name: 'The Double Date', // v2.2 COPY (decision 41d)
    line: 'Jane Doe and me, you and yours. A table for four and a second bottle nobody planned on.', // v2.2 COPY (decision 41d)
    detail: 'an evening · two couples · serves 4', // v2.2 COPY (decision 41d)
    mode: 'dates',
    flow: 'dates',
    windows: [],
    countsToward: 'weekly_cap',
    dateRule: 'any-day',
    overnightAllowed: false,
    servesMax: 4,
    servesMin: 4, // "serves 4": a table for four, so the booking screens don't ask (crewRange)
    bookable: true,
    availableUntil: null,
  },
  {
    // v2.2 (decision 41d): Mains, after The Double Date. Lock-in default = "any other" (decision 39).
    slug: 'the-family-hang',
    section: 'mains',
    name: 'The Family Hang', // v2.2 COPY (decision 41d)
    line: 'Bring everyone: partners, kids, the dog if it behaves. The kids disappear, and the grown-ups finally finish a sentence.', // v2.2 COPY (decision 41d)
    detail: 'an afternoon · kids too · serves up to 3 families', // v2.2 COPY (decision 41d)
    mode: 'dates',
    flow: 'dates',
    windows: [],
    countsToward: 'weekly_cap', // like Something New (part of a day); Jon can re-count it at lock-in
    dateRule: 'any-day',
    overnightAllowed: false,
    servesMax: 15, // "up to 3 families" has no head count: the site's usual group size
    bookable: true,
    availableUntil: null,
  },
  {
    slug: 'the-shore-ride',
    section: 'big-days',
    name: 'The Shore Ride',
    line: 'Pick the trail. I’ll try not to walk the steep bits.',
    detail: 'half a day · your bike, your trail · serves up to 6 · weather call by 7 am',
    mode: 'dates',
    flow: 'dates',
    windows: [],
    countsToward: 'big_day',
    dateRule: 'weekend-or-thu-fri',
    overnightAllowed: true,
    servesMax: 6,
    bookable: true,
    availableUntil: null,
  },
  {
    slug: 'catch-and-release',
    section: 'big-days',
    name: 'Catch & Release',
    line: 'Standing in a river, maybe catching a fish. Best meeting you’ll have all year.',
    detail: 'a day · serves 1–3 · gear sorted by text',
    mode: 'dates',
    flow: 'dates',
    windows: [],
    countsToward: 'big_day',
    dateRule: 'weekend-or-thu-fri',
    overnightAllowed: true,
    servesMax: 3,
    bookable: true,
    availableUntil: null,
  },
  {
    slug: 'the-grind',
    section: 'big-days',
    name: 'A hike or nature moment', // approved: Jon (2026-10-05)
    inSentence: 'a hike or nature moment', // approved: Jon (2026-10-05)
    line: 'The Grouse Grind, or something kinder. I’ll be the one stopping to “take in the view.”',
    detail: 'half a day · serves up to 8 · weather call by 7 am',
    mode: 'dates',
    flow: 'dates',
    windows: [],
    countsToward: 'big_day',
    dateRule: 'weekend-or-thu-fri',
    overnightAllowed: true,
    servesMax: 8,
    bookable: true,
    availableUntil: null,
  },
  {
    // v2.1 (decision 37f): Big Days, after the hike. Lock-in default 9 am, a day (decision 43(5)). The Bluebird, which
    // followed it, is off the menu (Jon, 2026-10-05).
    slug: 'the-day-trip',
    section: 'big-days',
    name: 'The Day Trip', // v2.1 COPY (decision 43)
    line: 'Pick somewhere an hour or two up the road. I’ll drive. You’re in charge of snacks.', // v2.1 COPY (decision 43)
    detail: 'a day · home by dark · one car · serves up to 4', // v2.1 COPY (decision 43)
    mode: 'dates',
    flow: 'dates',
    windows: [],
    countsToward: 'big_day',
    dateRule: 'weekend-or-thu-fri',
    overnightAllowed: false, // "home by dark"
    servesMax: 4,
    bookable: true,
    availableUntil: null,
  },
  {
    slug: 'surprise-me',
    section: 'off-the-menu',
    name: 'Surprise Me',
    line: 'You plan it. I don’t get to see the plan. Just tell me when, roughly where, and whether I need a helmet.',
    detail: 'any open time · serves up to 15',
    mode: 'slots',
    flow: 'surprise',
    windows: ['lunch', 'evening'],
    countsToward: 'weekly_cap',
    overnightAllowed: false,
    servesMax: 15,
    bookable: true,
    availableUntil: null,
  },
  {
    slug: 'pitch-me',
    section: 'off-the-menu',
    name: 'Pitch Me',
    line: 'Got a better idea? If it fits in a day, or one night away, it’s probably a yes.',
    detail: 'you suggest, I confirm · serves up to 15',
    mode: 'dates',
    flow: 'pitch',
    windows: [],
    countsToward: 'jon_sets',
    dateRule: 'any-day',
    overnightAllowed: true,
    servesMax: 15,
    bookable: true,
    availableUntil: null,
    // Decision 43(7): "You choose." leads the examples; "Cook a dish." (food you cook) replaces the old first line.
    suggestionsLead: 'You choose.', // v2.2 COPY (decision 43)
    suggestions: [
      'Cook a dish.', // v2.2 COPY (decision 43)
      'Try something new.', // v2.2 COPY (decision 43)
      'Do watercolours together.', // v2.2 COPY (decision 43)
      'Build something.',
      'A night by a campfire.',
      'Or take me to the thing you’re best at.',
    ],
  },
  {
    // v2.1 (decision 37f): Off the Menu, after Pitch Me. Lock-in default = "any other" (decision 39).
    slug: 'something-new',
    section: 'off-the-menu',
    name: 'Something New', // v2.1 COPY (decision 43)
    line: 'Something neither of us has tried. Pottery, axe throwing, a cold plunge. We’ll both be bad at it, which is the fun part.', // v2.1 COPY (decision 43)
    detail: 'an evening or half a day · serves up to 6', // v2.1 COPY (decision 43)
    mode: 'dates',
    flow: 'dates',
    windows: [],
    countsToward: 'weekly_cap', // like The Encore; at most 1 locked a week (decision 43(4), canLock)
    dateRule: 'any-day',
    overnightAllowed: false,
    servesMax: 6,
    bookable: true,
    availableUntil: null,
    maxPerWeek: 1, // decision 43(4)
  },
];

// S04 /menu + S05 dish sheets (pack v2.2 s04, gen.py menu_block/sheets): what the page shows that DISHES lacks.
// Every line is the FROZEN pack's, word for word (decision 14a house style: "noon–2 pm"; DISHES.detail is the
// one-line form the booking screens use, in the same style since QA r2 L2).
/** The caption over the page's h1. */
export const MENU_CAP = 'April to June 2027'; // PACK v2.2 s04 .menu-head .cap
/** Landmark and control labels on /menu. */
export const MENU_LABELS = {
  courses: 'Courses', // PACK v2.2 s04 (the course nav)
  close: (name: string) => `Close ${name}`, // PACK v2.2 s05 (the sheet's × button)
};

export interface DishCard {
  /** the photo slot (src/ui/photo-slots.ts) on its row and at the top of its sheet */
  slot: string;
  /** the row's detail lines (.dl), in order */
  detail: readonly string[];
  /** the sheet’s facts (dt, dd); a display-only dish would have none (no sheet) */
  facts: readonly (readonly [string, string])[];
  /** the sheet's "what happens next" line */
  next: string | null;
  /** a small line under the photo, on the row and in the sheet */
  caption?: string;
}

export const DISH_CARDS: Readonly<Record<DishSlug, DishCard>> = {
  'the-flat-white': {
    slot: 'flat-white',
    detail: ['30 min · Thu/Fri, noon–2 pm', 'serves 1–3'],
    facts: [
      ['Length', '30 min'],
      ['When', 'Thu/Fri, noon–2 pm'],
      ['Serves', '1–3'],
    ],
    next: 'Pick a few times. I’ll lock one in within two days.',
  }, // PACK v2.2 s04/s05
  'the-first-round': {
    slot: 'first-round',
    detail: ['Thu/Fri, from 7 pm', 'serves up to 15'],
    facts: [
      ['When', 'Thu/Fri, from 7 pm'],
      ['Serves', 'up to 15'],
    ],
    next: 'Pick a few times. I’ll lock one in within two days.',
  }, // PACK v2.2 s04/s05
  'the-long-distance': {
    slot: 'long-distance',
    detail: ['45 min · any day we both can', 'phone or video'],
    facts: [
      ['Length', '45 min'],
      ['When', 'any day we both can'],
      ['How', 'phone or video'],
    ],
    next: 'Pick a day that works, and tell me your time zone.',
  }, // PACK v2.2 s04/s05
  'the-long-lunch': {
    slot: 'long-lunch',
    detail: ['2 hr · Thu/Fri, noon–2 pm', 'serves 1–15 (my wallet prefers 1–6)'],
    facts: [
      ['Length', '2 hr'],
      ['When', 'Thu/Fri, noon–2 pm'],
      ['Serves', '1–15 (my wallet prefers 1–6)'],
    ],
    next: 'Pick a few times. I’ll lock one in within two days.',
  }, // PACK v2.2 s04/s05
  'the-old-haunt': {
    slot: 'old-haunt',
    detail: ['2 hr · Thu/Fri or a weekend', 'serves up to 15'],
    facts: [
      ['Length', '2 hr'],
      ['When', 'Thu/Fri or a weekend'],
      ['Serves', 'up to 15'],
    ],
    next: 'Pick a few times. I’ll lock one in within two days.',
  }, // PACK v2.2 s04/s05
  'the-encore': {
    slot: 'encore',
    detail: ['an evening', 'serves up to 15'],
    facts: [
      ['Length', 'an evening'],
      ['Serves', 'up to 15'],
    ],
    next: 'Pick a few times. I’ll lock one in within two days.',
  }, // PACK v2.2 s04/s05
  'the-double-date': {
    slot: 'double-date',
    detail: ['an evening', 'two couples · serves 4'],
    facts: [
      ['Length', 'an evening'],
      ['Who', 'two couples'],
      ['Serves', '4'],
    ],
    next: 'Pick a date or two. Weekends are fine.',
  }, // PACK v2.2 s04/s05
  'the-family-hang': {
    slot: 'family-hang',
    detail: ['an afternoon', 'kids too · serves up to 3 families'],
    facts: [
      ['Length', 'an afternoon'],
      ['Who', 'partners and kids'],
      ['Serves', 'up to 3 families'],
    ],
    next: 'Pick a date or two. Weekends are fine.',
  }, // PACK v2.2 s04/s05
  'the-shore-ride': {
    slot: 'shore-ride',
    detail: ['half a day · weather call by 7 am', 'your bike, your trail · serves up to 6'],
    facts: [
      ['Length', 'half a day'],
      ['Where', 'your bike, your trail'],
      ['Serves', 'up to 6'],
      ['Weather', 'call by 7 am'],
    ],
    next: 'Pick a date or two. Weekends are fine.',
  }, // PACK v2.2 s04/s05
  'catch-and-release': {
    slot: 'catch-release',
    detail: ['a day', 'gear sorted by text · serves 1–3'],
    facts: [
      ['Length', 'a day'],
      ['Gear', 'sorted by text'],
      ['Serves', '1–3'],
    ],
    next: 'Pick a date or two. Weekends are fine.',
  }, // PACK v2.2 s04/s05
  'the-grind': {
    slot: 'grind',
    detail: ['half a day · weather call by 7 am', 'serves up to 8'],
    facts: [
      ['Length', 'half a day'],
      ['Serves', 'up to 8'],
      ['Weather', 'call by 7 am'],
    ],
    next: 'Pick a date or two. Weekends are fine.',
  }, // PACK v2.2 s04/s05
  'the-day-trip': {
    slot: 'day-trip',
    detail: ['a day · home by dark', 'one car · serves up to 4'],
    facts: [
      ['Length', 'a day'],
      ['Home', 'by dark'],
      ['Serves', 'up to 4 (one car)'],
    ],
    next: 'Pick a date or two. Weekends are fine.',
  }, // PACK v2.2 s04/s05
  'surprise-me': {
    slot: 'surprise-me',
    caption: 'No snowboard lessons offered', // approved: Jon (2026-10-05)
    detail: ['any open time', 'serves up to 15'],
    facts: [
      ['When', 'any open time'],
      ['Serves', 'up to 15'],
    ],
    next: 'Pick a few times. The plan stays yours.',
  }, // PACK v2.2 s04/s05
  'pitch-me': {
    slot: 'pitch-me',
    detail: ['you suggest, I confirm', 'serves up to 15'],
    facts: [
      ['When', 'you suggest, I confirm'],
      ['Serves', 'up to 15'],
    ],
    next: 'Tell me the idea and roughly when. I’ll confirm.',
  }, // PACK v2.2 s04/s05
  'something-new': {
    slot: 'something-new',
    detail: ['an evening or half a day', 'serves up to 6'],
    facts: [
      ['Length', 'an evening or half a day'],
      ['Serves', 'up to 6'],
    ],
    next: 'Pick a date or two. Weekends are fine.',
  }, // PACK v2.2 s04/s05
};

/** A dish's line as the menu shows it: Pitch Me adds its lead and its examples (pack s04/s05). */
export function menuLine(d: Pick<Dish, 'line' | 'suggestionsLead' | 'suggestions'>): string {
  return [d.line, d.suggestionsLead, ...(d.suggestions ?? [])].filter(Boolean).join(' ');
}
