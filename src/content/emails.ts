// src/content/emails.ts — C5 copy for the 18 templates (E1–E16 + E4c + E5b + E5j; E15 removed in TSD v1.4, E4m with Change time 2026-09-29). Sign-off "Jon" on its own line.
// Guest emails come from jon@, Jon-facing (E2, E3, E12, E13, E14, E16) from admin@. Text only here;
// HTML layouts are UI work after the Design Review Gate.
import { MANAGE_UI } from './manage';
import { NO_GIFTS_PS, SEE_THE_MENU } from './site';
export type TemplateId =
  | 'E1'
  | 'E2'
  | 'E3'
  | 'E4'
  | 'E4c'
  | 'E5'
  | 'E5b'
  | 'E5j'
  | 'E6'
  | 'E7'
  | 'E8'
  | 'E9'
  | 'E10'
  | 'E11'
  | 'E12'
  | 'E13'
  | 'E14'
  | 'E16'
  | 'E17'; // E15 removed in TSD v1.4 (stories@ forwards to Gmail)
export const JON_FACING: TemplateId[] = ['E2', 'E3', 'E12', 'E13', 'E14', 'E16'];
export interface EmailCopy {
  subject: string;
  body: string;
}
/** {placeholders} are filled by fill(). {times} / {link} blocks are rendered by the template. */
export const EMAIL_COPY: Record<TemplateId, EmailCopy> = {
  E1: {
    subject: 'Got it: {dish}',
    body: 'Got your times:\n{times}\nI’ll lock one in within two days.\n{manageLink}',
  }, // Jon option A: E1 lists the requested times; UX-09 / F20: every guest email carries the manage link
  E2: { subject: 'New request: {dish} from {name}', body: '{name} wants {dish}. {summary}\n{adminLink}' },
  E3: {
    subject: 'Still waiting: {name}, {dish}',
    body: '{name} has been waiting a day for {dish}.\n{adminLink}',
  },
  E4: {
    subject: 'Locked in: {dish}, {day}',
    body: '{when}. You pick the place, just tell me where. The calendar invite comes from Time with Jon, so look out for it. If plans change, use the link below and we’ll find another day.\n{manageLink}',
  }, // approved: Jon (2026-10-09) Q1: his text; copyFor drops "You pick the place" for joined guests / a set place
  E4c: {
    subject: 'Calendar update: {dish}',
    body: '{lead}',
  }, // AD-6 .ics fallback, lane L5; C-4. {lead} is one of E4C_LEAD, chosen by the .ics method.
  E5: {
    subject: 'Another time for {dish}?',
    body: '{lead}These are still open:\n{times}\nTap one and it’s yours.\n{takeLink}',
  }, // creative v1.4 §6.5; {lead} is Jon's own line (optional); the one link line under the times (T2.4)
  E5b: {
    subject: 'Another time for {dish}?',
    body: 'Something came up that week, and it’s on me. {openTimes}\n{takeLink}',
  }, // §14.4. T2.5.02: {openTimes} is E5B_PARTS.withTimes(Jon's offer) or E5B_PARTS.noTimes; {takeLink} is empty with no offer
  E5j: {
    subject: 'About {dish}',
    body: 'That plan fell through, so your spot on it is off. I’ll send you a new time soon.',
  }, // T2.7, rule 4: a joined guest whose host cancelled; never names the host; lane L3.
  E6: {
    subject: 'You’re on stand-by',
    body: 'You’re on stand-by for the week of {week}. If something opens up, I’ll email you.',
  },
  E7: {
    subject: '{weekday} just opened up',
    body: '{when} is free now. Want it? It’s yours until {until}.\n{takeLink}', // approved: Jon (2026-10-09) Q4
  }, // the one link line at the end (T2.4, pr51-review L3); {until} is the offer's real expiry, Vancouver time
  E8: {
    subject: 'About your pitch',
    body: 'I love this. It’s also {length}, and I promised one night away, max. Pitch me the shorter version?\n{manageLink}',
  }, // the one link line at the end (T2.4, pr51-review L3)
  E9: {
    subject: 'About your pitch',
    body: 'I can’t make this one happen, and I’d rather say so than leave it hanging. Pick anything else and it’s yours.\n{menuLink}',
  }, // the one link line at the end (T2.4, pr51-review L3)
  E10: { subject: 'Weather call', body: 'It’s pouring. Let’s move it.\n{pickLink}' }, // the one link line at the end (T2.4, pr51-review L3)
  E11: { subject: 'Cancelled, no guilt', body: 'Done. No guilt. The menu’s still there when you’re ready.' },
  E12: {
    subject: 'Cancelled: {dish}, {when}',
    body: '{name} cancelled {dish} ({when}). Stand-by for that week: {standby}\n{adminLink}',
  }, // T2.7.07: "({when})" so an unlocked request reads "(no time locked yet)"
  // TSD staleness fix: E13 no longer counts dropped mail (inbound is Cloudflare Email Routing). The hourly
  // "What's new" digest reuses E13 (T3.2.06, flagged for review): {lines} holds one subject per email.
  E13: { subject: 'New stories: {count}', body: '{lines}\n{adminLink}' },
  E14: {
    subject: 'Google connection problem',
    body: 'The “Time with Jon” calendar connection stopped working. Connect it again in Settings.\n{adminLink}',
  },
  E16: { subject: 'Updated: {dish} from {name}', body: '{name} picked new times for {dish}.\n{adminLink}' }, // §14.4
  // QA r2 M5 (T2.9): Jon's "Cancel for the guest" (A3). The guest's own cancel keeps E11. Q8 (Jon 2026-10-09): a
  // "Pick a new date" button to the manage page, where "Ask for another time" is open to them.
  E17: {
    subject: 'I’m booked on that day. Can we try another day?', // approved: Jon (2026-10-04)
    body: 'Hey, can you suggest one or two other times that work in your calendar? Sorry, my calendar is a little more full than I expected. I’ll be in touch.\n{manageLink}', // approved: Jon (2026-10-04); link line: Q8, 2026-10-09
  },
};
/** E12 fillers when the cancelled request had no locked time, or its week has nobody on stand-by (T2.7.07).
 *  With no locked time there is no week, so the stand-by sentence is left out (EML-15; see copyFor). */
export const E12_PARTS = {
  noTime: 'no time locked yet',
  nobody: 'nobody',
  /** QA4b M3: a host cancelled; the guests joined to that booking (they get E5j and wait on Jon). */
  joined: (names: string) => `Joined to it: ${names}.`, // NEW COPY (needs Jon)
} as const;
/** E12 with no week (EML-15): the same body without its stand-by sentence. {standby} is '' then. */
const E12_NO_WEEK_BODY = EMAIL_COPY.E12.body.replace(' Stand-by for that week: {standby}', '');
/** EML-10: the hourly "What's new" digest (TSD AD-5 rule 3) reuses E13's body; its lines are emails, not stories. */
export const E13_HOURLY_SUBJECT = 'What’s new: {count}'; // NEW COPY (needs Jon)
/** E4c's opening line, by the attached .ics method (REQUEST adds or moves the entry, CANCEL removes it). */
export const E4C_LEAD = {
  REQUEST:
    'Here’s the calendar invite for {dish}, {when}. It’s attached: open it to add it to your calendar.',
  CANCEL: '{dish}, {when}, is off. Open the attached update to take it off your calendar.',
} as const;
/** Q6 (approved: Jon 2026-10-09): one item reads in the singular. */
export const SINGULAR = {
  gotTimes: 'Got your time:', // approved: Jon (2026-10-09) Q6 (E1, one time or date)
  stillOpen: 'This one’s still open:', // approved: Jon (2026-10-09) Q6 (E5, E5b, one offered time)
  pickedNew: 'picked a new time', // approved: Jon (2026-10-09) Q6 (E16, one time or date)
} as const;
const STILL_OPEN = 'These are still open:';
/** "These are still open:", or the singular for one time (Q6). */
export const stillOpen = (times: string) => (times.includes('\n') ? STILL_OPEN : SINGULAR.stillOpen);
/** T2.5.02: E5b's two middles. A joined guest always gets noTimes (the offer is the host's; rule 3). */
export const E5B_PARTS = {
  withTimes: (times: string) => `${stillOpen(times)}\n${times}\nTap one and it’s yours.`,
  noTimes: 'I’ll send you some new times soon.',
} as const;
export const SIGN_OFF = 'Jon';
/**
 * EML-03: a guest email's link line is a button with these labels in the HTML part (as Jon's mails have); the
 * text part keeps the URL on its own line. A long token URL is never the visible text of a link.
 */
export const GUEST_BUTTON = {
  E1: 'Change or cancel', // approved: Jon (2026-10-09) Q3 (UX-09: F20, the manage link in every guest email)
  E4: 'Change or cancel', // approved: Jon (2026-10-09) Q3
  E5: 'Take it', // approved: Jon (2026-10-09) Q3 (the offer page: "Tap one and it’s yours.")
  E5b: 'Take it', // approved: Jon (2026-10-09) Q3
  E7: 'Take it', // approved: Jon (2026-10-09) Q3
  E8: MANAGE_UI.askAnother, // PACK v2.2 s17: the manage page's own action (it carries the pitch, EML-05)
  E9: SEE_THE_MENU, // v2.1 COPY (decision 37b): "Pick anything else and it’s yours."
  E10: 'Pick a new date', // approved: Jon (2026-10-09) Q3
  E17: 'Pick a new date', // approved: Jon (2026-10-09) Q8
} as const satisfies Partial<Record<TemplateId, string>>;
/** A P.S. under the signature (Jon decisions 45 + 47a): E1 "Got it" carries the no-gifts P.S. and its tag link. */
export const POSTSCRIPT: Partial<Record<TemplateId, typeof NO_GIFTS_PS>> = { E1: NO_GIFTS_PS };
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * AD-7: the admin sign-in email (Supabase sends it; the file is supabase/templates/admin-sign-in.html, and
 * config.toml carries the subject). EML-12: word for word the signed design pack a1d (G1); the template is checked
 * against these lines (content.test.ts). Each Supabase project's dashboard copy must be set to match.
 */
export const ADMIN_SIGN_IN_EMAIL = {
  subject: 'Time with Jon admin sign-in', // PACK a1d (TSD AD-7 had "Your Time with Jon sign-in code")
  heading: 'Time with Jon admin sign-in', // PACK a1d
  code: 'Your code:', // PACK a1d
  orButton: 'Or use the button on the device you want to sign in on:', // PACK a1d
  button: 'Sign in', // PACK a1d
  footer:
    'The code and the link work once. Didn’t ask for this? Ignore it. Nobody gets in without the code or the tap.', // PACK a1d
} as const;

/** E1 with no {times} (a row queued before E1 listed them, or an empty list): the pre-option-A body. */
export const E1_NO_TIMES_BODY = 'Got your times. I’ll lock one in within two days.';

/** Q1 (approved: Jon 2026-10-09): E4 drops this for a joined guest and when Jon set the place. */
const E4_PICK_PLACE = ' You pick the place, just tell me where.';
const E7_UNTIL = ' It’s yours until {until}.';

/**
 * The copy one email renders with, for both its text and its HTML part: the template's, or its variant for these
 * vars. E1 with no {times} keeps the pre-option-A body; one time reads in the singular (Q6: E1, E5, E5b, E16); E4
 * with {placeKnown} drops "You pick the place" (Q1); E12 with no week drops the stand-by sentence (EML-15) and a
 * host's E12 adds its joined guests (QA4b M3); the hourly digest ({digest: 'hourly'}) has its own subject (EML-10).
 * A row queued before a var existed (E1/E17 {manageLink}, E7 {until}) renders as it was queued, never with an
 * unfilled placeholder.
 */
export function copyFor(id: TemplateId, vars: Record<string, string | number>): EmailCopy {
  const c = EMAIL_COPY[id] as EmailCopy | undefined;
  if (!c) return { subject: '', body: '' }; // not a template id (only a copy scanner calls it so)
  let body = id === 'E1' && !vars.times ? `${E1_NO_TIMES_BODY}\n{manageLink}` : c.body;
  // Only E1 and E17 gained their link line after rows were queued; every other template still fails closed on a
  // missing link (pr28 review M2: never a literal "{manageLink}", never a guest email without its link).
  if ((id === 'E1' || id === 'E17') && !('manageLink' in vars)) body = body.replace('\n{manageLink}', '');
  const one = (v: string | number | undefined) => typeof v === 'string' && v !== '' && !v.includes('\n');
  switch (id) {
    case 'E1':
      if (one(vars.times)) body = body.replace('Got your times:', SINGULAR.gotTimes);
      break;
    case 'E4':
      if (vars.placeKnown) body = body.replace(E4_PICK_PLACE, '');
      break;
    case 'E5':
      if (one(vars.times)) body = body.replace(STILL_OPEN, SINGULAR.stillOpen);
      break;
    case 'E7':
      if (!('until' in vars)) body = body.replace(E7_UNTIL, '');
      break;
    case 'E12':
      if (vars.standby === '') body = E12_NO_WEEK_BODY;
      // QA4b M3: the joined guests' line, on its own line before the link, only when a host cancelled with guests.
      if (vars.joined) body = body.replace('\n{adminLink}', '\n{joined}\n{adminLink}');
      break;
    case 'E13':
      if (vars.digest === 'hourly') return { subject: E13_HOURLY_SUBJECT, body };
      break;
    case 'E16':
      if (vars.count === 1) body = body.replace('picked new times', SINGULAR.pickedNew);
      break;
  }
  return { subject: c.subject, body };
}
