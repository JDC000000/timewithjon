// src/content/emails.ts — C5 copy for the 18 templates (E1–E16 + E4c + E5b + E5j; E15 removed in TSD v1.4, E4m with Change time 2026-09-29). Sign-off "Jon" on its own line.
// Guest emails come from jon@, Jon-facing (E2, E3, E12, E13, E14, E16) from admin@. Text only here;
// HTML layouts are UI work after the Design Review Gate.
import { NO_GIFTS_PS } from './site';
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
  E1: { subject: 'Got it: {dish}', body: 'Got your times:\n{times}\nI’ll lock one in within two days.' }, // Jon option A: E1 lists the requested times
  E2: { subject: 'New request: {dish} from {name}', body: '{name} wants {dish}. {summary}\n{adminLink}' },
  E3: {
    subject: 'Still waiting: {name}, {dish}',
    body: '{name} has been waiting a day for {dish}.\n{adminLink}',
  },
  E4: {
    subject: 'Locked in: {dish}, {day}',
    body: '{when}. You pick the place, just tell me where. The calendar invite comes from Time with Jon, so look out for it. If plans change, use the link below and we’ll find another day.\n{manageLink}',
  }, // creative v1.4 §6.5 (resolves C-4); "use the link below" in place of the inline [change or cancel] link
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
  E7: { subject: '{weekday} just opened up', body: '{when} is free now. Want it?\n{takeLink}' }, // the one link line at the end (T2.4, pr51-review L3)
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
  // QA r2 M5 (T2.9): Jon's "Cancel for the guest" (A3). The guest's own cancel keeps E11. No link: they reply.
  E17: {
    subject: 'I’m booked on that day. Can we try another day?', // approved: Jon (2026-10-04)
    body: 'Hey, can you suggest one or two other times that work in your calendar? Sorry, my calendar is a little more full than I expected. I’ll be in touch.', // approved: Jon (2026-10-04)
  },
};
/** E12 fillers when the cancelled request had no locked time, or its week has nobody on stand-by (T2.7.07). */
export const E12_PARTS = {
  noTime: 'no time locked yet',
  noWeek: 'no week yet',
  nobody: 'nobody',
} as const;
/** E4c's opening line, by the attached .ics method (REQUEST adds or moves the entry, CANCEL removes it). */
export const E4C_LEAD = {
  REQUEST:
    'Here’s the calendar invite for {dish}, {when}. It’s attached: open it to add it to your calendar.',
  CANCEL: '{dish}, {when}, is off. Open the attached update to take it off your calendar.',
} as const;
/** T2.5.02: E5b's two middles. A joined guest always gets noTimes (the offer is the host's; rule 3). */
export const E5B_PARTS = {
  withTimes: (times: string) => `These are still open:\n${times}\nTap one and it’s yours.`,
  noTimes: 'I’ll send you some new times soon.',
} as const;
export const SIGN_OFF = 'Jon';
/** A P.S. under the signature (Jon decisions 45 + 47a): E1 "Got it" carries the no-gifts P.S. and its tag link. */
export const POSTSCRIPT: Partial<Record<TemplateId, typeof NO_GIFTS_PS>> = { E1: NO_GIFTS_PS };
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * AD-7: the admin sign-in email (Supabase sends it; the file is supabase/templates/admin-sign-in.html, and
 * config.toml carries the subject). The heading line was added for review M3 and needs Jon's copy sign-off.
 */
export const ADMIN_SIGN_IN_EMAIL = {
  subject: 'Your Time with Jon sign-in code', // TSD AD-7
  heading: 'Time with Jon admin sign-in',
} as const;

/** E1 with no {times} (a row queued before E1 listed them, or an empty list): the pre-option-A body. */
export const E1_NO_TIMES_BODY = 'Got your times. I’ll lock one in within two days.';
