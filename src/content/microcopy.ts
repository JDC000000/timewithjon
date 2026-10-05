// src/content/microcopy.ts — creative v1.2 §6.1–6.2 + TSD §14.4 lines (approved, decision 31).
import type { RequestStatus } from '@/features/availability/types';

export const FLOW = {
  pickerTitle: 'When works? Tap as many as you like. I’ll lock one in.',
  pickerTz: 'All times Vancouver time.',
  datesTitle: 'Pick a date or two.',
  datesHint: 'Weekends are fine.',
  overnightTitle: 'Which night?',
  overnightHint: 'One night away, max. Tell me the date and roughly where.',
  weekFull: 'That week’s spoken for.',
  standby: 'Put me on stand-by',
  orPickAnother: 'or pick another week.',
  spokenForRun: 'The next few weeks are spoken for. A weekend Big Day or a call might be easier.',
  opensOn: (date: string) => `Booking opens ${date}.`, // date rendered from settings
  away: (until: string, confirmBy: string) => `I’m away until ${until}. I’ll confirm by ${confirmBy}.`,
  timeZoneLabel: 'Your time zone',
  nameLabel: 'Your name',
  emailLabel: 'Your email',
  emailHint: 'So I can send the invite.',
  phoneLabel: 'Phone (optional)',
  phoneHint: 'Only if I don’t have it.',
  crewLabel: 'Who’s coming?',
  crewDefault: 'Just me.',
  crewHint:
    'Just you is perfect. Up to 15 is fine. Bring someone from the old days if you like. Bonus points if I haven’t seen them in years.',
  noteLabel: 'Anything I should know?',
  notePlaceholder: 'Allergies, grudges, parking.',
  send: 'Send',
  surprisePlanLabel: 'The plan.',
  surprisePlanHint: 'I won’t see this. Promise.',
  surpriseNeedLabel: 'What I need to know.',
  surpriseNeedHint: 'When, roughly where, what to wear. Helmet or no helmet.',
  pitchIdeaLabel: 'What’s the idea?',
  pitchIdeaHint: 'What are you best at? Take me there.',
  pitchWhenLabel: 'When were you thinking?',
  pitchWhenHint: 'A date, a week, or ‘sometime in May’ all work.',
};
export const ERRORS = {
  noTimes: 'Pick at least one time and I’ll do the rest.',
  badEmail: 'That email doesn’t look right. One more try?',
  stale: 'This link’s gone a bit stale. Text me and I’ll send you a fresh one.', // S16
  noInvite: 'Booking works from the link I sent you. Can’t find it? Text me.', // wireframe 04-C
  botCheck: 'Something got in the way. Try once more, or text me.',
  rateLimited: 'Easy, tiger. Give it a minute and try again.',
  offerGone: 'Looks like that one went. I’ll send you more.', // S18
  outOfSeason: 'That one’s outside April to June. Pick a date between April 1 and June 30.',
  timeGone: 'One of those times just went. Pick another and I’ll do the rest.',
  generic: 'Something went sideways on my end. Try once more, or text me.',
};
export const GUEST_LABEL: Record<RequestStatus, string> = {
  requested: 'Sent',
  locked: 'Locked in',
  needs_new_time: 'Let’s find another time',
  standby: 'On stand-by',
  cancelled: 'Cancelled, no guilt',
  done: '',
};
export const CLOSED_IN_PERSON_LABEL = 'Sorted. See you soon.'; // R2-L4
/** The status line on /manage when Jon cancelled for the guest (the guest's own cancel keeps "Cancelled, no guilt"). */
export const JON_CANCELLED_LABEL = 'Cancelled, no problem'; // approved: Jon (2026-10-05)
export const ALREADY = {
  lockedIn: (when: string) => `You’re locked in for ${when}.`,
  cancelled: 'Already cancelled. No guilt.',
};
/** Jon-facing (admin only). */
export const JON_FLAGS = {
  bigCrew: 'Big crew: treat it like a pitch',
  bounced: 'Email bounced: text them',
  rsvpNo: 'Can’t make it (per Google): check with them', // TSD v1.9 wording (guest_rsvp = 'no')
};
