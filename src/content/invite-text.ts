// src/content/invite-text.ts — T2.6.02: the text Jon pastes with a link (creative v1.4 §6.7, Jon-approved 8.2).
// Jon writes the personal first line himself, every time; the link is never sent on its own.
// "quality time" is allowed HERE ONLY (creative v1.4 §3: Jon's phrase, off the page); content.test.ts exempts
// exactly this module from that ban and nothing else.
export const INVITE_TEXT = {
  /** Shown after "{Name}." for Jon to overwrite before he sends it. */
  personalOwnLine: '[Jon writes this line himself]',
  personalBody:
    'I turn 50 on April 1, and I’m looking for quality time with friends this spring. Lunch, a ride, a beer, your call.',
  openBody:
    'I turn 50 on April 1. No joke. I’m looking for quality time with friends this spring: lunches, rides, a first round, whatever you pitch. Pick something.',
} as const;
