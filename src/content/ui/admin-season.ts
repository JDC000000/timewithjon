// src/content/ui/admin-season.ts — lane U6 copy for the admin season screens (A4 season view, A4b week sheet,
// A4c away sheet) that isn't in src/content yet. Approved with the copy list (decision 31).

/**
 * T2.5.05 (decision 30, G1 #21 (b)): the week sheet's preview line for bookings already under way, which a block
 * leaves to finish. Jon approved the singular; the plural is its plain inflection. null when there are none.
 */
export function underWayLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? '1 booking is under way and will finish as planned.' // g1-pack #21 (b)
    : `${count} bookings are under way and will finish as planned.`; // plural of #21 (b)
}

/** A4 season list (T2.5.U1): the pack's words for the list pane and each week row. */
export const SEASON = {
  title: 'Season', // PACK v1.12 a4-season
  meter: (count: number, target: number) => `Big Days · ${count} of about ${target}`, // PACK v1.12 a4-season
  range: 'April to June 2027', // PACK v1.12 a4-season
  awayCard: 'Away', // PACK v1.12 a4-season
  awayEdit: 'Edit', // PACK v1.12 a4-season
  awayEditVh: ' away mode', // PACK v1.12 a4-season
  weekOf: 'Week of', // PACK v1.12 a4-season
  cap: (used: number, cap: number) => `${used} of ${cap}`, // PACK v1.12 a4-season
  awayWeek: 'Away', // PACK v1.12 a4-season
  heldForFamily: 'held for family', // PACK v1.12 a4-season
  blocked: 'blocked', // PACK v1.12 a4-season
  bigDay: 'Big Day', // PACK v1.12 a4-season
  busy: 'busy on your calendar', // PACK v1.12 a4-season
  standby: (n: number) => `${n} on stand-by`, // PACK v1.12 a4-season
  seasonEnds: 'Season ends', // PACK v1.12 a4-season
  lastWeekOnly: 'Big Days, The Encore or The Long Distance only', // PACK v1.12 a4-season
  pickWeek: 'Pick a week.', // PACK v1.12 a4-season
  pickWeekSub: 'Block times, hold a day, or offer a stand-by.', // PACK v1.12 a4-season
} as const;

/** The admin list+detail page frame (pack adm_page): the two panes' names. */
export const PANES = {
  list: 'List', // PACK v1.12 a4-season
  detail: 'Detail', // PACK v1.12 a4-season
  titleSeason: 'Season · Time with Jon admin', // PACK v1.12 a4-season
  titleWeek: (label: string) => `Week of ${label} · Season · Time with Jon admin`, // PACK v1.12 a4b-week
  titleAway: 'Away mode · Time with Jon admin', // PACK v1.12 a4c-away
  back: 'Season', // PACK v1.12 a4b-week ("‹ Season")
} as const;

/** A4b week pane (T2.5.U1): one Open/Blocked choice per date (orchestrator ruling Q1), its windows listed under it. */
export const WEEK = {
  openToGuests: 'Open to guests', // PACK v1.12 a4b-week
  open: 'Open', // PACK v1.12 a4b-week
  blocked: 'Blocked', // PACK v1.12 a4b-week
  blockedByYou: 'Blocked by you', // PACK v1.12 a4b-week
  locked: 'Locked', // PACK v1.12 a4b-week ("Locked · Robin")
  openBooking: 'Open', // PACK v1.12 a4b-week
  openBookingVh: (name: string) => ` ${name}’s booking`, // PACK v1.12 a4b-week
  busy: 'Busy on your calendar', // PACK v1.12 a3-request-detail
  heldForFamily: 'Held for family', // approved: Jon (2026-10-03): the list's "held for family" as a window's note
  done: 'Done', // approved: Jon (2026-10-03): a past booking's window ("Done · Robin")
  thisWeek: 'This week', // PACK v1.12 a4b-week
  blockWholeWeek: 'Block the whole week', // PACK v1.12 a4b-week
  allowThird: 'Allow a 3rd this week', // PACK v1.12 a4b-week
  onStandby: 'On stand-by', // PACK v1.12 a4b-week
  since: (day: string) => `since ${day}`, // PACK v1.12 a4b-week
  offer: (when: string) => `Offer ${when}`, // PACK v1.12 a4b-week
  offerVh: (name: string) => ` to ${name}`, // PACK v1.12 a4b-week
} as const;

/** A4b: blocking over a locked booking, confirmed in place (orchestrator ruling Q3). */
export const BLOCK = {
  title: 'Block anyway?', // PACK v1.12 a4b (wf09 state-block)
  lockedFor: (when: string, name: string) => `${when} is locked for ${name}.`, // PACK v1.12 a4b (wf09 state-block)
  // wf09 said '…with fresh times.', but E5b goes with no times (ruling Q3; E5B_PARTS.noTimes): pr78-review F2
  tell: 'I’ll send them “Something came up that week” and some new times soon.', // approved: Jon (2026-10-03)
  confirm: (names: string[]) =>
    names.length === 1
      ? `Block and tell ${names[0]}` // PACK v1.12 a4b (wf09 state-block)
      : 'Block and tell them', // approved: Jon (2026-10-03): more than one locked booking
  keep: 'Keep it open', // PACK v1.12 a4b (wf09 state-block)
} as const;

/** A4c away pane (T2.5.U1). "I’ll confirm by" = Back on + 2 days (orchestrator ruling Q2), shown in the notice. */
export const AWAY = {
  cap: 'Season', // PACK v1.12 a4c-away
  title: 'Away mode', // PACK v1.12 a4c-away
  off: 'Off', // approved: Jon (2026-10-03): the list card when no away range is set ("Away · Off")
  from: 'From', // PACK v1.12 a4c-away
  backOn: 'Back on', // PACK v1.12 a4c-away
  errDate: 'Add a date.', // PACK v1.12 a4c-away
  errAfter: 'Back on has to be after From.', // PACK v1.12 a4c-away
  sumFrom: 'Add the first day away.', // PACK v1.12 a4c-away
  sumTo: 'Add the day you’re back.', // PACK v1.12 a4c-away
  toFix: (n: number) => `${['', 'One thing', 'Two things', 'Three things'][n] ?? `${n} things`} to fix`, // PACK v1.12 site.js errsum
  whatGuestsSee: 'What guests see', // PACK v1.12 a4c-away
  whatItDoes: 'What it does', // PACK v1.12 a4c-away
  hides: (from: string, to: string) => `Hides every time from ${from} to ${to}.`, // PACK v1.12 a4c-away
  locked: (n: number) =>
    n === 0
      ? 'No locked bookings in that range.' // PACK v1.12 a4c-away
      : n === 1
        ? '1 locked booking in that range.' // singular of the pack's "{n} locked bookings in that range"
        : `${n} locked bookings in that range.`, // PACK v1.12 a4c-away (g1-pack copy list)
  requests: (back: string) => `Requests still come in. Your reply promise restarts on ${back}.`, // PACK v1.12 a4c-away
  save: 'Save away mode', // PACK v1.12 a4c-away
  saving: 'Saving…', // PACK v1.12 a4c-away
  turnOff: 'Turn away mode off', // PACK v1.12 a4c-away
  oldStill: 'Your new dates are saved, but the old ones are still there. Save again to clear them.', // approved: Jon (2026-10-03): pr78-review F6
  saved: 'Away mode saved.', // PACK v1.12 (g1-pack copy list: "Away mode, after it saves")
} as const;

/** A6 stories (T2.9.U1, T3.7.U1): wireframe 09 A6 (no v1.12 mock); lines the wireframe lacks are NEW COPY. */
export const STORIES = {
  title: 'Stories', // PACK v1.12 wf09 A6
  titlePage: 'Stories · Time with Jon admin', // PACK v1.12 wf09 A6
  cap: 'The Stories We Still Tell', // PACK v1.12 wf09 A6
  add: 'Add emailed story', // PACK v1.12 wf09 A6
  after: (dish: string) => `after ${dish}`, // PACK v1.12 wf09 A6
  capAfter: (dish: string) => `After ${dish}`, // PACK v1.12 wf09 A6
  byEmail: 'sent by email', // approved: Jon (2026-10-03) (an emailed story has no dish)
  ok: 'OK for the book', // PACK v1.12 wf09 A6
  notOk: 'not for the book', // PACK v1.12 wf09 A6
  spam: 'possible spam', // PACK v1.12 wf09 A2 ("Check these · 1 possible spam")
  noName: 'No name', // approved: Jon (2026-10-03)
  empty: 'No stories yet.', // approved: Jon (2026-10-03)
  pick: 'Pick a story to read it.', // approved: Jon (2026-10-03)
  back: 'Stories', // PACK v1.12 wf09 A6 ("‹ Stories")
  photo: (n: number) => `Photo ${n}`, // PACK v1.12 wf09 A6 ("Photo 1 thumbnail")
  photoMissing: (n: number) => `Photo ${n} couldn’t load`, // approved: Jon (2026-10-03)
  before60: 'Before 60', // PACK v1.12 a3k ("Before 60")
  spamNote: 'This one looks like spam, so it can’t go in the book.', // approved: Jon (2026-10-03)
  consentSaved: (name: string, ok: boolean) =>
    ok ? `${name}’s story is OK for the book.` : `${name}’s story is not for the book.`, // approved: Jon (2026-10-03)
  added: 'Added to the book pile.', // approved: Jon (2026-10-03)
  addedNoPhotos: (failed: number) =>
    failed === 1
      ? 'Added to the book pile, but 1 photo didn’t upload.'
      : `Added to the book pile, but ${failed} photos didn’t upload.`, // approved: Jon (2026-10-03)
} as const;

/** The A6 "Add emailed story" sheet (T3.7.U1): wireframe 09 A6. */
export const ADD_STORY = {
  name: 'From (name)', // PACK v1.12 wf09 A6
  email: 'Their email', // PACK v1.12 wf09 A6
  story: 'The story', // PACK v1.12 wf09 A6
  storyHelp: 'Paste it from the email.', // PACK v1.12 wf09 A6
  photos: 'Photos (up to 5)', // PACK v1.12 wf09 A6
  addPhotos: 'Add photos', // PACK v1.12 wf09 A6
  picked: (n: number) => (n === 1 ? '1 photo picked' : `${n} photos picked`), // approved: Jon (2026-10-03)
  consent: 'They said yes in email', // PACK v1.12 wf09 A6
  submit: 'Add to the book pile', // PACK v1.12 wf09 A6
  busy: 'Adding…', // approved: Jon (2026-10-03)
  errName: 'Add their name.', // approved: Jon (2026-10-03)
  errStory: 'Paste the story.', // approved: Jon (2026-10-03)
  errPhotos: 'Up to 5 photos.', // approved: Jon (2026-10-03)
} as const;

/** A7 settings (T2.9.U1, T3.3.U1, T3.15.U1 A7 part): wireframe 09 A7, A7b, A7c, A7d. */
export const SETTINGS = {
  title: 'Settings', // PACK v1.12 wf09 A7
  titlePage: 'Settings · Time with Jon admin', // approved: Jon (2026-10-03) (the phone's group list)
  back: 'Settings', // PACK v1.12 wf09 A7 ("‹ Settings")
  calendar: 'Calendar', // PACK v1.12 wf09 A7
  opening: 'Opening times', // PACK v1.12 wf09 A7
  replies: 'Replies and stories', // PACK v1.12 wf09 A7
  titleCalendar: 'Calendar · Settings · Time with Jon admin', // PACK v1.12 wf09 A7
  titleOpening: 'Opening times · Settings · Time with Jon admin', // PACK v1.12 wf09 A7b
  titleReplies: 'Replies · Settings · Time with Jon admin', // PACK v1.12 wf09 A7c
  save: 'Save', // PACK v1.12 wf09 A7b
  saving: 'Saving…', // approved: Jon (2026-10-03)
  saved: 'Saved.', // approved: Jon (2026-10-03)
  nothingChanged: 'Nothing changed.', // approved: Jon (2026-10-03)
} as const;

/** A7 / A7d Calendar (T3.3.U1 Connect Google + the health banner, T3.15.U1 Re-sync). */
export const CALENDAR = {
  google: 'Google', // PACK v1.12 wf09 A7
  connected: (checked: string | null) => (checked ? `Connected · checked ${checked}` : 'Connected'), // PACK v1.12 wf09 A7
  notConnected: 'Not connected', // PACK v1.12 wf09 A7d
  calendar: 'Calendar', // PACK v1.12 wf09 A7
  busy: 'Busy check', // PACK v1.12 wf09 A7
  busyValue: 'Your personal main calendar', // PACK v1.12 wf09 A7
  invites: 'Invites', // PACK v1.12 wf09 A7
  invitesValue: 'Sent from Time with Jon; you’re an attendee', // PACK v1.12 wf09 A7
  lastGood: 'Last good check', // PACK v1.12 wf09 A7d
  meanwhile: 'Meanwhile', // PACK v1.12 wf09 A7d
  meanwhileValue: 'New bookings go out as .ics invites', // PACK v1.12 wf09 A7d
  banner: 'Google isn’t connected. Locks will send .ics until you reconnect.', // PACK v1.12 wf09 A7d
  connect: 'Connect Google', // PACK v1.12 wf09 A7d
  reconnect: 'Reconnect Google', // PACK v1.12 wf09 A7d
  resync: 'Re-sync calendar', // PACK v1.12 wf09 A7
  resyncing: 'Re-syncing…', // approved: Jon (2026-10-03)
  resyncNone: 'Nothing to re-sync: no bookings ahead.', // approved: Jon (2026-10-03)
  resyncAll: (n: number) =>
    n === 1 ? 'Your 1 booking is on your calendar.' : `All ${n} bookings are on your calendar.`, // approved: Jon (2026-10-03)
  resyncSome: (done: number, all: number) =>
    `${done} of ${all} bookings are on your calendar; the rest follow in a few minutes.`, // approved: Jon (2026-10-03)
  resyncNotConnected: 'Google isn’t connected. Connect it first.', // approved: Jon (2026-10-03)
  disconnect: 'Disconnect Google',
  disconnectAsk: 'Disconnect Google? New bookings go out as .ics invites until you reconnect.',
  disconnectAskGmail: 'Disconnect Google? Emails and invites stop sending until you reconnect.',
  disconnectYes: 'Yes, disconnect',
  disconnectNo: 'Keep it connected',
  disconnecting: 'Disconnecting…',
  disconnectRetry: 'Google didn’t answer, so it’s still connected. Try again in a minute.',
  /** After Google's consent screen (?google=… from /api/admin/google/callback). */
  result: {
    connected: 'Google is connected.', // approved: Jon (2026-10-03)
    cancelled: 'Google isn’t connected: you said no on Google’s screen.', // approved: Jon (2026-10-03)
    expired: 'That took too long. Try Connect Google again.', // approved: Jon (2026-10-03)
    foreign_account: 'That Google account isn’t yours on the list. Try again with your own.', // approved: Jon (2026-10-03)
    scopes: 'Google needs every box ticked. Try again and leave them all on.', // approved: Jon (2026-10-03)
    failed: 'Google didn’t connect. Try again.', // approved: Jon (2026-10-03)
    /** After A7 "Disconnect Google" (T3.3.05 route): revoked at Google, or only forgotten here. */
    disconnected: 'Google is disconnected.',
    disconnected_here:
      'Google is disconnected here. To be sure, remove Time with Jon at myaccount.google.com/permissions.',
  },
} as const;

/** A7b Opening times (T2.9.U1): wireframe 09 A7b. */
export const OPENING = {
  personal: 'Personal links open', // PACK v1.12 wf09 A7b
  general: 'The general link opens', // PACK v1.12 wf09 A7b
  tz: 'Vancouver time', // PACK v1.12 wf09 A7b
  time: (label: string) => `${label} time`, // PACK v1.12 wf09 A7b ("Personal links open time")
  date: (label: string) => `${label} date`, // approved: Jon (2026-10-03) (the date field's name)
  errOrder: 'Personal links have to open before the general link.', // approved: Jon (2026-10-03)
  errRange: 'Pick a time between now and the end of the season.', // approved: Jon (2026-10-03)
  errDate: 'Pick a date.', // approved: Jon (2026-10-03)
} as const;

/** A7c Replies and stories (T2.9.U1): wireframe 09 A7c. */
export const REPLIES = {
  promise: 'Reply promise', // PACK v1.12 wf09 A7c
  promiseHelp: 'Shown to guests after Send.', // PACK v1.12 wf09 A7c
  days: (n: number) => (n === 1 ? '1 day' : `${n} days`), // PACK v1.12 wf09 A7c ("2 days", "3 days")
  before60: 'Ask guests “What should we do before I’m 60?” after Send', // PACK v1.12 wf09 A7c
  reached: 'People reached', // PACK v1.12 wf09 A7c
} as const;
