// src/content/site.ts — creative v1.4 §2 (hero, Jon's words) + v1.2/v1.3 §5, §6.3, §6.4, §6.6, §6.7.
export const WORDMARK = 'TIME WITH JON'; // NAMING.md: all caps only for the wordmark
/** Open-link hero line, FIXED by Jon (decisions item 9.1; v2.1 wording: decision 37a): no shuffling. */
export const OPEN_LINE =
  'We keep saying we should do lunch, that beer, a mountain bike lap, an epic trip or something new.'; // v2.1 COPY (decision 37a)
export const LEAD_IN = OPEN_LINE;
export const HEADLINE = 'How about now?';
export const HERO_DATE_LINE = 'I turn 50 on April 1. No joke.';
/** Jon's own words (creative v1.4 §2.2): "epic" is allowed ONLY in the hero lines. */
export const HERO_BODY =
  'We see each other at plenty of parties, which is great. This time I’d rather do something epic with you, or you and a small group, even if epic is a long lunch. Pick something off the menu and I’ll lock in a time.';
const EPIC_TRIP = 'that epic trip';
export const SEE_THE_MENU = 'See the activity menu'; // v2.1 COPY (decision 37b)
export const PERSONAL = {
  /**
   * Decisions item 9.2 / TSD v1.8: "{Name}." then this line. Blank -> the open-link line. QA r2 L5: each thing is
   * said once, and a thing that is the line's own "that epic trip" isn't said twice.
   */
  ourThingsLine: (things: readonly string[] | null) => {
    if (!things || things.length === 0) return OPEN_LINE;
    const seen = new Set([EPIC_TRIP]);
    const own = things.filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
    return own.length
      ? `We keep saying we should do ${own.join(', ')} or ${EPIC_TRIP}.`
      : `We keep saying we should do ${EPIC_TRIP}.`;
  },
  pickedLine: (dish: string) => `I was thinking ${dish}, but anything on the menu is yours.`,
  book: (dish: string) => `Book ${dish}`,
  seeWholeMenu: 'See the whole activity menu', // v2.1 COPY (decision 37d)
};
export const WHY_LINE =
  'At a party I get a hug, a drink and half a story before someone pulls you away. This time I’d like the whole story. A table, a couple of hours, and nowhere else to be.';
export const CLOSING_LINE = 'Time is the gift. Memory is the message. Looking forward is the point.'; // D-2 default: once, small
export const FOOTER = ['Questions? Text me. You’ve got the number.', 'Time with Jon · North Shore, BC'];
export const NOT_FOUND = { line: 'This page took the day off.', back: 'Back to the activity menu' }; // v2.1 COPY (decision 37d)
/**
 * Jon decisions 45 + 47a: "No gifts. Really." left the front of the site (the landing section, the nav link and the
 * S12 page are gone). It is now a P.S., the ONE source for both places it shows: the foot of the Sent page (S11,
 * lane U4) and the E1 "Got it" email under the signature (src/features/email/registry.ts). The link goes to the
 * printable tag (S12b, ROUTES.tag). Words: v22-copy.md "v2.2b (dec 44-45)", COPY FROZEN 2026-09-27 19:53 UTC.
 */
export const NO_GIFTS_PS = {
  mark: 'P.S.',
  text: 'No gifts. Really. The one thing I’ll take is a bottle of wine with a letter or an old photo tucked in. Write on the tag when I should open it. Bring it when we meet.',
  printTag: 'Print the tag',
} as const; // v2.2b COPY (decision 45, approved 47a)
export const WINE_TAG = {
  forJon: 'For Jon', // PACK v2.2 s12b (the .cap class sets it in capitals)
  backMark: 'TIME WITH JON · 2027', // creative v1.3 item 11
  openOn: 'Open on',
  from: 'From',
  noDate: 'No date? It opens on my 51st.',
};
export const SEND_A_STORY = {
  title: 'Can’t make a date?',
  body: 'Email me a photo from way back and a few lines. Any story, any length.',
  address: (domain: string) => `stories@${domain}`,
};
export const AFTER_SEND = {
  stamp: 'Sent.',
  promise: (fromAddress: string) =>
    `I’ll lock in a time within two days. Watch for an email from ${fromAddress}.`,
  sentTo: (email: string) => `Sent to ${email}. Wrong address? Text me.`, // §14.4
  askTitle: 'One question, if you’ve got a minute.',
  question: 'What’s a moment of ours you still talk about?',
  questionHint: 'The one you tell at dinner. Keep it clean-ish. Bonus if I haven’t heard it.',
  photoTitle: 'Got a favourite photo of us?',
  photoButton: 'Add one or two',
  photoHint: 'Old, blurry, bad haircut. All good.',
  consent: 'OK to use these in something I’m making at the end of the year. A book, maybe a deck of cards.',
  send: 'Send',
  before60: 'One more, if you like: what should we do before I’m 60?',
  skip: 'Skip for now', // wireframe 07
  thanks: 'Got it. Thank you.', // wireframe 07
};
