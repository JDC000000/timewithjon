// src/content/ui/admin-requests.ts — lane U5 copy for the admin sign-in (A1, A1b, A1c), the requests inbox (A2)
// and the request detail (A3, A3b, A3c) that isn't in src/content yet. Words come from the v1.12 design pack and
// the approved wireframe 09 (the copy list Jon approved, decision 31; each line names its source).
// A line with no source in the pack or wireframe is marked NEW COPY (needs Jon): a placeholder Jon must write.

export const SIGN_IN = {
  title: 'Sign in',
  pageTitle: 'Sign in · Time with Jon admin',
  admin: 'Admin',
  emailLabel: 'Your email',
  emailEmpty: 'Add the admin email.', // approved (decision 28)
  /** The error summary line for a malformed address (the field itself says ERRORS.badEmail). */
  emailBadSummary: 'Check your email.', // approved (g1 copy, a1)
  send: 'Send me a code',
  sending: 'Sending…', // approved (g1 copy, a1c)
  help: 'No email after 2 minutes? Text your site helper for a sign-in link.', // (TSD §14.4, R17)
  // A1b: the code step
  codeTitle: 'Check your email', // approved (g1 copy, a1b)
  codePageTitle: 'Enter the code · Time with Jon admin',
  onTheirWay: (email: string) => `A code and a link are on their way to ${email}.`, // approved (g1 copy, a1b)
  codeLabel: 'The 6-digit code',
  codeHint: 'Or tap the link in the email.',
  codeWrong: 'That code didn’t work. Try again, or send a new one.', // approved (g1 copy, a1b)
  signIn: 'Sign in',
  sendNew: 'Send a new code',
  /** The admin-verify 429 (pr26-review R2): the per-address window can last an hour, so it points to the link. */
  tooManyTries: 'Too many tries. Use the link in the same email.', // approved: Jon (2026-10-03) (tasks.md T2.1.U1 example; Jon writes the final line)
  /** /admin/sign-in?error=link: the emailed link was used up or expired; the code in the same email still works. */
  linkSpent: 'That link has already been used. Use the code in the same email.', // approved: Jon (2026-10-03) (no pack line; T2.1.04 "link expired, use the code")
  /** 503 from start/verify/confirm while the sign-in limiter can't count (fail closed, security review 2026-09-30). */
  unavailable: 'Sign-in is paused for a moment. Please try again in a few minutes.', // approved (Jon, 2026-09-30)
  // A1c: the one-tap confirm page (V5, g1 #20 (a))
  confirmTitle: 'One more tap.', // approved (g1 copy, a1c)
  confirmPageTitle: 'Confirm sign-in · Time with Jon admin',
  confirmLine: 'This signs you in to Time with Jon admin on this device.', // approved (g1 copy, a1c)
  confirmButton: 'Sign me in', // approved (g1 copy, a1c)
  confirmHelp: 'Didn’t ask to sign in? Close this page. Nothing happens without the tap.', // approved (g1 copy, a1c)
} as const;

/** The error summary heading ("Things to fix" / "One thing to fix"), as the pack's forms word it. */
export function fixCountHeading(n: number): string {
  const words = ['Things', 'One thing', 'Two things', 'Three things', 'Four things', 'Five things'];
  return `${words[n] ?? `${n} things`} to fix`;
}

/** A2: the requests inbox (pack a2-requests; wireframe 09 A2). */
export const INBOX = {
  title: 'Requests',
  pageTitle: 'Requests · Time with Jon admin',
  listLabel: 'List',
  detailLabel: 'Detail',
  filtersLabel: 'Show',
  checkThese: 'Check these',
  possibleSpam: (n: number) => `${n} possible spam`,
  /** The Big Day meter (TSD F18; wireframe 09 A2 "Big Days · 2 of about 6"). */
  meter: (count: number, target: number) => `Big Days · ${count} of about ${target}`,
  /** Each filter, in the pack's order. */
  filters: {
    needs: 'Needs a reply',
    waiting: 'Waiting on them',
    standby: 'Stand-by',
    locked: 'Locked in',
    done: 'Done',
    cancelled: 'Cancelled',
  },
  /** An empty filter (pack a2: the Done filter). */
  emptyDone: 'Nothing’s in the past yet.',
  /** Every count 0 (wireframe 09 A2 empty). */
  emptyAll: 'Nothing waiting. Go outside.',
  /** Any other empty filter: no pack line; the wireframe's "Nothing waiting." half. */
  emptyFilter: 'Nothing here.', // approved: Jon (2026-10-03) (no pack line for an empty filter other than Done)
  truncated: (n: number) => `Showing the latest ${n}.`, // approved: Jon (2026-10-03) (T2.2.02 INBOX_LIMIT; no pack line)
  /** The desktop detail pane before a pick. */
  pickTitle: 'Pick a request.', // approved (g1 copy, a2)
  pickLine: 'The one waiting longest is at the top.', // approved (g1 copy, a2)
  crew: (n: number) => `crew ${n}`,
  weekOf: (day: string) => `week of ${day}`,
  bigDay: 'Big Day',
  noTimesLeft: 'No times left', // approved: Jon (2026-10-03) (TSD T2.2 cards "no times left" flag; no pack line)
  needNoun: 'need a reply',
} as const;

/** A3: one request (pack a3-request-detail; wireframe 09 A3, A3g-A3n). */
export const DETAIL = {
  pageTitle: (who: string, section: string) => `${who} · ${section} · Time with Jon admin`,
  back: {
    requests: 'Requests',
    locked: 'Locked in',
    done: 'Done',
    cancelled: 'Cancelled',
    standby: 'Stand-by',
  },
  /** The caption over the name. The wait is its own span (a unit is never set in caps: wireframe 09 R7-08). */
  needsReply: 'Needs a reply',
  waiting: 'Waiting on them',
  standby: 'Stand-by',
  locked: 'Locked in',
  done: 'Done',
  cancelled: 'Cancelled',
  personalLink: 'personal link', // (wireframe 09 A3g)
  bigDay: 'Big Day', // (wireframe 09 A3m "Locked in · Big Day")
  cancelledByGuest: 'Cancelled by guest', // (wireframe 09 A2d)
  cancelledByYou: 'Cancelled by you', // approved: Jon (2026-10-03) (no wireframe line)
  closedInPerson: 'Closed (in person)', // (wireframe 09 A2)
  /** Each picked time's line under it (wireframe 09 A3, A3f, A3o, A3o2). */
  timeMeta: {
    week: (weekOf: string, count: number, cap: number) => `Week of ${weekOf} · ${count} of ${cap}`, // (wireframe 09 A3)
    busy: 'Busy on your calendar', // (wireframe 09 A3)
    blocked: 'Blocked by you', // (wireframe 09 A3o)
    taken: 'Taken', // (wireframe 09 A3f "Taken: week full")
    past: 'Gone', // approved: Jon (2026-10-03) (no wireframe line: a time that has passed)
    window: 'Not this dish’s time', // approved: Jon (2026-10-03) (no wireframe line)
  },
  labels: {
    dish: 'Dish',
    crew: 'Crew',
    link: 'Link',
    note: 'Note',
    when: 'When',
    calendar: 'Calendar',
    idea: 'Idea',
    away: 'Away',
    plan: 'The plan',
    need: 'You need',
    was: 'Was', // (wireframe 09 A2d)
  },
  general: 'General',
  crew: (n: number) => (n === 1 ? 'Just me' : `${n} of us`), // (wireframe 09 A3)
  /** The Surprise Me plan is never shown (C4, AD-11): only that there is one. */
  sealed: 'Sealed. You don’t get to see it.', // (wireframe 09 A3j; tasks.md T2.2.U2 "Sealed plan on file")
  theirTimes: 'Their times',
  theirDates: 'Their dates',
  calendarState: {
    synced: 'On Time with Jon · invite sent · on your calendar', // (wireframe 09 A3k)
    ics_sent: 'Google didn’t answer · .ics sent · retrying', // (wireframe 09 A3m)
    pending: 'Adding to Time with Jon…', // approved: Jon (2026-10-03) (no wireframe line)
    failed: 'Google didn’t answer · check the calendar', // approved: Jon (2026-10-03) (no wireframe line; AD-6 out of retries)
    none: 'Not on the calendar', // approved: Jon (2026-10-03) (no wireframe line)
  },
} as const;

/** T2.8.U1: the autosaving notes on A3 (wireframe 09 A3k, A3k2; decision 28 "Saving…"). */
export const NOTES = {
  before60: 'Before 60',
  before60Help: 'What they said at the table. Saves as you type.', // (wireframe 09 A3b2/A3k)
  jonNote: 'Your note', // approved: Jon (2026-10-03) (no wireframe label for jon_note; TSD T2.8)
  jonNoteHelp: 'Only you see this. Saves as you type.', // approved: Jon (2026-10-03) (no wireframe line)
  saving: 'Saving…', // approved (decision 28)
  saved: (clock: string) => `Saved ${clock}`, // (wireframe 09 A3k "Saved 7:42 pm")
  failed: 'Couldn’t save.', // (wireframe 09 A3k2)
  retry: 'Try again', // (wireframe 09 A3k2)
} as const;

/** A3's action bar and ⋯ (pack a3, a3c; g1 copy a3/a3c approved). */
export const ACTIONS = {
  lockIn: 'Lock in',
  suggest: 'Suggest another time', // approved (g1 copy, a3c)
  more: (who: string) => `More for ${who}`, // approved (g1 copy, a3c)
  closeMore: (who: string) => `Close More for ${who}`,
  standby: 'Move to stand-by', // approved (g1 copy, a3c)
  copyEmail: 'Copy their email', // approved (g1 copy, a3c)
  cancel: 'Cancel', // approved (g1 copy, a3c)
  copied: (email: string) => `Copied ${email}.`, // approved (g1 copy, a3)
} as const;

/** A2 row meta words (pack a2 rows; wireframe 09 A2d). */
export const ROW = {
  times: (n: number) => (n === 1 ? '1 time' : `${n} times`), // (pack a2)
  dates: (n: number) => (n === 1 ? '1 date' : `${n} dates`), // (pack a2)
  cancelledByGuest: 'cancelled by guest', // (pack a2)
  cancelledByYou: 'cancelled by you', // approved: Jon (2026-10-03) (no pack line for a cancel by Jon)
  closedInPerson: 'closed (in person)', // (pack a2)
} as const;

/** A2b/A2c: Check these (wireframe 09 A2b, A2c; T2.9.04). */
export const CHECK = {
  listCaption: 'Requests · Check these', // (wireframe 09 A2b)
  pageTitle: 'Check these · Time with Jon admin', // (wireframe 09 A2b)
  caption: 'Check these · possible spam', // (wireframe 09 A2b)
  noName: '(no name)', // (wireframe 09 A2b)
  email: 'Email', // (wireframe 09 A2b)
  picked: 'Picked', // (wireframe 09 A2b)
  notSpam: 'Not spam', // (wireframe 09 A2b)
  delete: 'Delete', // (wireframe 09 A2b)
  confirm: 'Delete it for good? This can’t be undone.', // (wireframe 09 A2c)
  deleteIt: 'Delete it', // (wireframe 09 A2c)
  keepIt: 'Keep it', // (wireframe 09 A2c)
  movedToNeeds: (who: string) => `${who} is in Needs a reply now.`, // approved: Jon (2026-10-03) (status after Not spam)
  deleted: (who: string) => `Deleted ${who}’s request.`, // approved: Jon (2026-10-03) (wireframe 09: "a status says what went")
} as const;

/** T2.3.U1: Lock in and its undo window (A3b, A3b3; g1 copy a3b: the approved wireframe 09 words) and the lock ticks. */
export const LOCK = {
  locking: 'Locking in', // approved (g1 copy a3b: wireframe 09 A3b)
  toast: (who: string, when: string) => `Locked in: ${who}, ${when}.`, // approved (wireframe 09 A3b)
  countdown: (s: number) => `Invite goes out in ${s} s.`, // approved (wireframe 09 A3b)
  paused: 'Paused. The invite goes out 10 s after you leave Undo.', // approved (wireframe 09 A3b3)
  undo: 'Undo', // approved (wireframe 09 A3b)
  undoFor: (who: string) => ` lock-in for ${who}`, // approved (wireframe 09 A3b)
  sending: 'Sending…', // approved (g1 copy a3b)
  sent: 'Locked in. Invite sent.', // approved (wireframe 09 status messages)
  undone: (who: string) => `Undone. ${who}’s request is back in Needs a reply.`, // approved (g1 copy a3b)
  bookAnyway: 'Book anyway: that date’s blocked', // (wireframe 09 A3o)
  overrideWeek: (nth: string) => `Override this week: it would be the ${nth}`, // (wireframe 09 A3o2)
  /** T2.3.U1 contract: a live stand-by offer covers the time (the lock still went through). */
  standbyOfferLive: 'A stand-by offer was out for that time. It’s withdrawn.', // approved: Jon (2026-10-03)
} as const;

/** 3 -> "3rd", 4 -> "4th", 11 -> "11th", 21 -> "21st". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** T2.4.U1 / T2.3.U1 / T2.10.U1 / A3l: the A3 sheets and in-page confirms (wireframe 09 A3d-A3q, A3n3). */
export const SHEETS = {
  preview: 'Preview', // (wireframe 09 A3f)
  sentTo: (who: string) => `Sent to ${who}`, // (wireframe 09 status messages)
  close: (title: string) => `Close ${title}`,
  suggest: {
    intro: (who: string, dish: string) => `${who} · ${dish}. Pick the open times to offer.`, // (wireframe 09 A3f)
    legend: 'Open times', // (wireframe 09 A3f)
    send: (n: number) => (n === 1 ? 'Send 1 time' : `Send ${n} times`), // (wireframe 09 A3f "Send 2 times")
    none: 'No open times to offer right now.', // approved: Jon (2026-10-03) (no wireframe line)
  },
  standby: {
    intro: (who: string, dish: string) => `${who} · ${dish}`, // (wireframe 09 A3d)
    legend: 'Which week?', // (wireframe 09 A3d)
    full: 'full', // (wireframe 09 A3d)
    open: 'open', // (wireframe 09 A3d)
    commit: (who: string) => `Move ${who} to stand-by`, // (wireframe 09 A3d)
    /** Wireframe 09 A3e says "She'll get an email: You're on stand-by."; a name avoids guessing anyone's pronoun. */
    note: (who: string) => `${who} gets an email: You’re on stand-by.`, // (wireframe 09 A3e, name for "She")
  },
  cancel: {
    link: 'Cancel for the guest', // (wireframe 09 A3k)
    question: (who: string, dish: string, day: string) => `Cancel ${who}’s ${dish}, ${day}?`, // (wireframe 09 A3l)
    line: 'They’ll get an email and the invite goes.', // (wireframe 09 A3l)
    yes: 'Yes, cancel it', // (wireframe 09 A3l)
    keep: 'Keep it', // (wireframe 09 A3l)
    done: (who: string) => `Cancelled. ${who} gets an email.`, // approved: Jon (2026-10-03) (status after the cancel)
  },
  pitch: {
    open: 'About your pitch', // (wireframe 09 A3h)
    legend: 'Which reply?', // (wireframe 09 A3i)
    smaller: 'The smaller version', // (wireframe 09 A3i)
    no: 'An honest no, about the pitch', // (wireframe 09 A3i)
    lengthLabel: 'How long it is', // approved: Jon (2026-10-03) (Q9: E8 {length}, no wireframe field)
    lengthHint: 'Like “three nights long”.', // approved: Jon (2026-10-03)
    lengthMissing: 'Add how long it is.', // approved: Jon (2026-10-03)
    send: 'Send the reply', // (wireframe 09 A3i)
  },
  weather: {
    open: 'Weather call', // (wireframe 09 A3m)
    send: 'Send the weather call', // approved: Jon (2026-10-03) (Q10: no sheet drawn)
  },
  join: {
    flag: (when: string, host: string) => `Also wants ${when} with ${host}`, // (wireframe 09 A3n3)
    join: (host: string) => `Join to ${host}’s booking`, // (wireframe 09 A3n3)
    close: 'Close (handled in person)', // (wireframe 09 A3n3)
    promote: (who: string) => `Make ${who} the host`, // (wireframe 09 notes, T2.10 rule 4)
    joined: (host: string) => `Joined to ${host}’s booking.`, // approved: Jon (2026-10-03)
    closed: 'Closed. Handled in person.', // approved: Jon (2026-10-03)
    promoted: (who: string) => `${who} is the host now.`, // approved: Jon (2026-10-03)
  },
} as const;

/** T2.3.U1: the dates-mode Lock sheet's words (wireframe 09 A3g2, A3g3, A3h). Its defaults: LOCK_DEFAULTS. */
export const LOCK_SHEET = {
  title: (who: string, dish: string) => `Lock in ${who}’s ${dish}`, // (wireframe 09 A3g2)
  date: 'Date', // (wireframe 09 A3g2)
  firstPick: 'first pick', // (wireframe 09 A3g2 "his first pick", without the pronoun)
  time: 'Time', // (wireframe 09 A3g2)
  start: 'Start', // (wireframe 09 A3g2)
  vancouver: '(Vancouver time)', // (wireframe 09 A3g2)
  other: 'Other…', // (wireframe 09 A3g3)
  startTime: 'Start time', // (wireframe 09 A3g3)
  startHint: 'Like 10:30 am', // (wireframe 09 A3g3)
  startBad: 'Add a time, like 10:30 am.', // approved: Jon (2026-10-03)
  length: 'Length', // (wireframe 09 A3g2)
  countsAs: 'Counts as', // (wireframe 09 A3h)
  countsHint: 'A day out counts as a Big Day by default.', // (wireframe 09 A3h)
  counts: { big_day: 'Big Day', weekly_cap: 'This week’s 2', none: 'Neither' }, // (wireframe 09 A3h)
  lockIn: (day: string, time: string) => `Lock in ${day}, ${time}`, // (wireframe 09 A3g2)
  lockOpen: 'Lock in…', // (wireframe 09 A3h)
} as const;

/**
 * Q8 (orchestrator 2026-09-27): THE lock-sheet defaults table, a Jon decision (wireframe 09 notes). Every row is
 * a placeholder until Jon confirms; a changed default is a one-line edit here. Start times are Vancouver HH:mm.
 */
export const LOCK_DEFAULTS = {
  /** The Length chips: the words (wireframe 09 A3g2) and their minutes. */
  lengths: [
    { words: '45 min', minutes: 45 }, // approved: Jon (2026-10-03)
    { words: '2 hr', minutes: 120 }, // approved: Jon (2026-10-03)
    { words: 'an evening', minutes: 180 }, // approved: Jon (2026-10-03)
    { words: 'half a day', minutes: 240 }, // approved: Jon (2026-10-03)
    { words: 'a day', minutes: 480 }, // approved: Jon (2026-10-03)
  ],
  /** The Start options every dated dish offers (plus its own default). */
  starts: ['07:00', '09:00', '12:00'], // approved: Jon (2026-10-03)
  /** Per dish: the Start and Length picked when the sheet opens. */
  byDish: {
    'the-shore-ride': { start: '09:00', minutes: 240 }, // approved: Jon (2026-10-03)
    'the-grind': { start: '09:00', minutes: 240 }, // approved: Jon (2026-10-03)
    'catch-and-release': { start: '07:00', minutes: 480 }, // approved: Jon (2026-10-03)
    'the-long-distance': { start: '18:00', minutes: 120 }, // approved: Jon (2026-10-03)
    'the-encore': { start: '19:00', minutes: 180 }, // approved: Jon (2026-10-03)
    'the-old-haunt': { start: '12:00', minutes: 120 }, // approved: Jon (2026-10-03)
    'pitch-me': { start: '09:00', minutes: 480 }, // approved: Jon (2026-10-03)
    'the-day-trip': { start: '09:00', minutes: 480 }, // decision 43(5): 9 am, a full day
  } as Record<string, { start: string; minutes: number }>,
  /** Any other dish: Something New, The Double Date, The Family Hang (decisions 39, 41d). */
  fallback: { start: '09:00', minutes: 120 }, // approved: Jon (2026-10-03)
  /** A pitch of at least this many minutes counts as a Big Day by default (wireframe 09 A3h "a day out"). */
  pitchBigDayMinutes: 240, // approved: Jon (2026-10-03)
} as const;

/** T3.2.U1 / T3.13.U1 / T3.15.U1: email problems and the RSVP flag's action (TSD AD-5 rule 4; wireframe 09 A3n, A3n2). */
export const MAIL = {
  limit: (time: string) => `Email limit reached: guests will get today’s emails at ${time}.`, // (TSD AD-5 rule 4)
  failed: 'Email didn’t send', // approved: Jon (2026-10-03) (T3.2.U1 failed-send badge; no wireframe line)
  resend: 'Resend', // (tasks.md T3.2.08 "A Resend button")
  resent: 'Sent again.', // approved: Jon (2026-10-03) (status after Resend)
  text: (who: string) => `Text ${who}`, // (wireframe 09 A3n2)
} as const;
