// src/content/ui/booking.ts — lane U3 copy for the booking flow (S6 picker, S7 dates, S8 Surprise Me / Pitch Me,
// S10 details) that isn't in src/content yet. Every line is word for word from the approved design pack v1.12
// (designs/final + site.js) or the approved wireframes 05/06, marked '// PACK v1.12 <screen>'; a genuinely new line
// is marked '// approved: Jon (2026-10-03)'.
// Lines that already live in src/content (FLOW, ERRORS) are imported from there, never repeated here.

import { MENU_TITLE } from '@/content/menu';

/** "One thing to fix" … "Five things to fix", then "{n} things to fix" (pack site.js error summary). */
export function thingsToFix(count: number): string {
  const words = ['', 'One thing', 'Two things', 'Three things', 'Four things', 'Five things'];
  return `${words[count] ?? `${count} things`} to fix`; // PACK v1.12 s10b-send-errors
}

/** How a window reads on a tile and in lists (G1 decision 14, the house style): short on the tile, full elsewhere. */
export const WINDOW_WORDS = {
  lunch: { short: 'noon', full: 'noon–2 pm' },
  evening: { short: '7 pm', full: '7 pm' },
} as const;

export const PICKER = {
  legend: 'Times that work', // PACK v1.12 s06-picker (visually hidden)
  monthTabsLabel: 'Month', // PACK v1.12 s06-picker (the tab list's name)
  /** A month tab's suffix: "May · 2 picked" (the " · " is visually hidden). */
  monthPicked: (n: number) => `${n} picked`, // PACK v1.12 s06-picker
  monthStandby: 'stand-by', // PACK v1.12 wireframe 05-E ("April · stand-by")
  standbyHint: 'If that week opens up, I’ll email you first.', // PACK v1.12 s06-picker
  standbyFor: (week: string) => `Put me on stand-by for ${week}`, // PACK v1.12 s06-picker (the collapsed run)
  standbyReplaces: 'Stand-by replaces your picked times.', // PACK v1.12 wireframe 05-E
  awayWeek: 'I’m away that week.', // PACK v1.12 s06-picker-away
  runCaption: (first: string, last: string) => `${first} to ${last}`, // PACK v1.12 s06-picker ("Jun 3–4 to Jun 17–18")
  /** The summary line when Send has no pick (the inline error under the legend is ERRORS.noTimes). */
  noTimesSummary: 'Pick at least one time.', // PACK v1.12 s06-picker (site.js)
  count: (n: number) => (n === 1 ? '1 time picked' : `${n} times picked`), // PACK v1.12 s06-picker ("2 times picked")
  countNone: 'No times yet', // PACK v1.12 s06-picker
  countShort: (n: number) => `${n} picked`, // PACK v1.12 s06-picker (sticky bar)
  picked: (label: string, n: number) => `Picked ${label}. ${pluralTimes(n)} picked.`, // PACK v1.12 s06-picker (site.js, announced)
  removed: (label: string, n: number) => `Removed ${label}. ${pluralTimes(n)} picked.`, // PACK v1.12 s06-picker (site.js, announced)
};

export const RAIL = {
  yourPicks: 'Your picks', // PACK v1.12 s06-picker
  empty: 'Tap a time on the left.', // PACK v1.12 s06-picker (site.js)
  remove: 'Remove', // PACK v1.12 s06-picker (the hidden rest of the name is the time)
  yourDetails: 'Your details ↓', // PACK v1.12 s06-picker
  otherDish: 'Pick a different activity', // PACK v1.12 s06-picker; v2.1 COPY (decision 37e)
};

export const FLOW_UI = {
  backToMenu: MENU_TITLE, // PACK v1.12 s06-picker (header back link); v2.1 COPY (decision 37d)
  sending: 'Sending…', // PACK v1.12 s10-details-send (busy Send; T1.7.U4)
  /** The sticky bar's Send (T1.7.U5): the visually hidden rest of its name, apart from the form's own Send. */
  barSendRest: ' request', // approved: Jon (2026-10-03)
};

/** S10 details on every flow's Send (T1.7.U4): the lines FLOW and ERRORS don't carry. */
export const DETAILS = {
  nameError: 'Tell me your name.', // approved: Jon (2026-10-03)
  /** The crew stepper's buttons (Q9; the label is FLOW.crewLabel). */
  crewFewer: 'One fewer', // PACK v1.12 s10-details-send (crew stepper)
  crewMore: 'One more', // PACK v1.12 s10-details-send (crew stepper)
};

/** S7 date request (T1.6.U1-U3) and the Old Haunt weekend mode (T1.6.U6). */
export const DATES = {
  pageTitle: (dish: string) => `Pick dates · ${dish} · Time with Jon`, // PACK v1.12 s07-date-request
  legend: 'Dates that work', // PACK v1.12 s07-date-request (visually hidden)
  prevMonth: 'Previous month', // PACK v1.12 s07-date-request
  nextMonth: 'Next month', // PACK v1.12 s07-date-request
  /** A day's name: "8, Saturday May 8"; Old Haunt weekdays add ", weekends only". */
  dayName: (day: number, long: string) => `${day}, ${long}`, // PACK v1.12 s07-date-request
  weekendsOnly: 'Weekends only', // PACK v1.12 wireframe 05-G2 (the month caption)
  weekendsOnlySuffix: ', weekends only', // PACK v1.12 wireframe 05-G2 (a weekday’s hidden name)
  chipsLabel: 'Your dates', // PACK v1.12 s07-date-request (the chip list; the rail heading too)
  remove: (long: string) => `Remove ${long}`, // PACK v1.12 s07-date-request (site.js)
  twoMax: 'Two dates max. Pick a third and I’ll swap out the oldest.', // PACK v1.12 s07-date-request
  roughToggle: 'Rather give a rough window?', // PACK v1.12 s07-date-request
  roughPlaceholder: 'sometime in May', // PACK v1.12 s07-date-request
  oneNight: 'It’s one night away', // PACK v1.12 s07-date-request
  noDates: 'Pick a date or two.', // PACK v1.12 s07-date-request (inline and summary)
  count: (n: number) => `${n} picked`, // PACK v1.12 s07-date-request (by Send)
  picked: (short: string) => `Picked ${short}.`, // PACK v1.12 s07-date-request (site.js, announced)
  swapped: (short: string) => `Swapped out ${short}. `, // PACK v1.12 s07-date-request (site.js, announced)
  removed: (long: string) => `Removed ${long}.`, // PACK v1.12 s07-date-request (site.js, announced)
  /** The lead under "Pick a date or two." for the dishes the pack draws another way. */
  leads: {
    'the-long-distance': 'Any day we both can.', // PACK v1.12 wireframe 05-C
    'the-encore': 'Any night of the week.', // PACK v1.12 wireframe 05-D
  } as Readonly<Record<string, string>>,
};

/** The Long Distance "Your time zone" (T1.6.U2; the label is FLOW.timeZoneLabel). */
export const TIME_ZONE = {
  help: 'Set from your phone. Change it if that’s wrong.', // PACK v1.12 wireframe 05-C
  /** The options in the drawn order; the last one keeps the zone the phone reports. */
  options: [
    { value: 'America/Vancouver', label: 'Vancouver (Pacific)' }, // PACK v1.12 wireframe 05-C
    { value: 'America/Edmonton', label: 'Calgary (Mountain)' }, // PACK v1.12 wireframe 05-C
    { value: 'America/Winnipeg', label: 'Winnipeg (Central)' }, // PACK v1.12 wireframe 05-C
    { value: 'America/Toronto', label: 'Toronto (Eastern)' }, // PACK v1.12 wireframe 05-C
    { value: 'America/Halifax', label: 'Halifax (Atlantic)' }, // PACK v1.12 wireframe 05-C
    { value: 'America/St_Johns', label: 'St. John’s (Newfoundland)' }, // PACK v1.12 wireframe 05-C
    { value: 'Europe/London', label: 'London' }, // PACK v1.12 wireframe 05-C
    { value: 'Europe/Paris', label: 'Paris / Berlin' }, // PACK v1.12 wireframe 05-C
    { value: 'Australia/Sydney', label: 'Sydney' }, // PACK v1.12 wireframe 05-C
  ],
  elsewhere: 'Somewhere else', // PACK v1.12 wireframe 05-C
};

/** S8 Surprise Me (T1.6.U4, pack gen.py s08()). */
export const SURPRISE = {
  pageTitle: 'Surprise Me · Time with Jon', // PACK v1.12 s08-surprise-me
  heading: 'Plan it. I won’t peek.', // PACK v1.12 s08-surprise-me
  lead: 'You plan it. I don’t get to see the plan. Just tell me when, roughly where, and whether I need a helmet.', // PACK v1.12 s08-surprise-me
  whenWorks: 'When works', // PACK v1.12 s08-surprise-me
  planHeading: 'The plan', // PACK v1.12 s08-surprise-me
  needLabel: 'What I need to know', // PACK v1.12 s08-surprise-me
  planLabel: 'The plan (optional)', // PACK v1.12 s08-surprise-me
  needError: 'Tell me what I need to know: when, roughly where, helmet or no helmet.', // PACK v1.12 s08-surprise-me
  needSummary: 'Tell me what I need to know.', // PACK v1.12 s08-surprise-me
};

/** Pitch Me (T1.6.U5, wireframe 06-B/C2/F; the lead is the dish line). */
export const PITCH = {
  pageTitle: 'Pitch Me · Time with Jon', // PACK v1.12 wireframe 06-B
  heading: 'Pitch it.', // PACK v1.12 wireframe 06-B
  try: 'Try:', // PACK v1.12 wireframe 06-B
  added: 'Added a starter', // PACK v1.12 wireframe 06 (announced)
  ideaError: 'Give me the idea, even a rough one.', // PACK v1.12 wireframe 06-C2
  ideaSummary: 'Give me the idea', // PACK v1.12 wireframe 06-C2
  yourPitch: 'Your pitch', // PACK v1.12 wireframe 06-B (rail)
  oneNightAway: 'one night away', // PACK v1.12 wireframe 06-F (rail)
};

/** The Old Haunt switch (T1.6.U6, wireframe 05-G/G2). */
export const OLD_HAUNT = {
  toWeekend: 'Pick a weekend date instead', // PACK v1.12 wireframe 05-G
  toTimes: 'Back to Thu/Fri times', // v2.1 COPY (decision 43(9), wireframe 05-G2)
};

function pluralTimes(n: number): string {
  return n === 1 ? '1 time' : `${n} times`;
}
