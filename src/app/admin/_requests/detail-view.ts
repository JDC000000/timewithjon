// src/app/admin/_requests/detail-view.ts — how one request reads on A3 (pack a3; wireframe 09 A3, A3g, A3h, A3j,
// A3k): the caption, where "‹" goes back to, the facts list, and their times or dates. Pure (the page passes now).
// The sealed plan is never here: only `hasSealedPlan` (C4, AD-11).
import { CHECK, DETAIL, INBOX, ROW, SHEETS } from '@/content/ui/admin-requests';
import type { RequestDetail } from '@/features/admin/detail';
import { PITCH } from '@/content/ui/booking';
import { dishAfterPossessive } from '@/content/menu-helpers';
import { dayLabel, vancouverInstant } from '@/lib/time';
import { ageLabel, shortDate, whenLabel, zoneLabel } from './format';
import { flagsOf, type FilterKey } from './rows';

export interface Fact {
  label: string;
  value: string;
  /** A guest's own words, set as a quote ("“…”"). */
  quote?: boolean;
  /** QA4b M3: the value as links (the people a booking is shared with), each to its own detail. */
  links?: { text: string; href: string }[];
}

export interface TimeChoice {
  slotId: string;
  label: string;
  /** The line under it: its week's count, or why it's gone. */
  meta: string;
  open: boolean;
  /** Jon may still lock it: open, or gone for a reason a lock flag overrides (T2.3: Book anyway / Override this week). */
  lockable: boolean;
  override: 'bookAnyway' | 'overrideWeek' | null;
  /** With overrideWeek: which booking of the week this would be ("the 3rd"). */
  nth: number | null;
}

export interface DetailView {
  who: string;
  /** "Needs a reply · " + the wait (set apart: a unit is never in caps), or one word. */
  caption: { text: string; unit?: string; after?: string };
  filter: FilterKey;
  back: { href: string; label: string };
  pageTitle: string;
  facts: Fact[];
  /** Slots mode: every time they picked, earliest first; `open` = still bookable (the C3 engine). */
  times: TimeChoice[];
  /** Dates mode: the dates they asked for. */
  dates: string[];
  /** Waiting on Jon or on them: the lock bar applies. */
  open: boolean;
  /** Jon-only flags (bounce, RSVP no, no times left), as rows over the facts. */
  flags: string[];
  /** A possible spam request (Check these, A2b): Not spam / Delete instead of the lock bar. */
  spam: boolean;
  /** Dates mode: their dates as YYYY-MM-DD (the Lock sheet's options). */
  dateKeys: string[];
  /** A Pitch Me request: "About your pitch" is the fill, "Lock in…" opens the dates sheet (wireframe 09 A3h). */
  pitch: boolean;
  /**
   * QA4 M2: a dated request (a Big Day, The Encore, a weekend Old Haunt, a pitch), with or without dates: Lock in
   * opens the dates sheet. With only a rough window (no dates), the sheet asks for any date in the season.
   */
  datesMode: boolean;
  /** QA4 M1: the guest said it's one night away: the Lock sheet picks the overnight length. */
  overnight: boolean;
  /** A locked Big Day: the weather call applies (wireframe 09 A3m). */
  bigDayLocked: boolean;
  /** "Cancel Sam's Old Haunt, Thu May 13?": the dish without a leading "The" and the locked day (wireframe 09 A3l). */
  cancelWords: { dish: string; day: string } | null;
  /** T3.2.U1: this request's emails that failed for good; each may offer Resend. */
  failed: { id: string; resendable: boolean }[];
  /** QA4b M3: a joined guest riding on a booking that is on: "Joined to {host}'s booking.", to the host's detail. */
  joinedTo: { text: string; href: string } | null;
  /** QA4b M3: Make {name} the host applies: joined to a booking that is no longer on (T2.10 rule 4). */
  canPromote: boolean;
}

function datePrefs(raw: unknown): { dates: string[]; windowText: string | null } {
  const p = (raw ?? {}) as { dates?: unknown; window_text?: unknown };
  const dates = Array.isArray(p.dates) ? p.dates.filter((d): d is string => typeof d === 'string') : [];
  return { dates, windowText: typeof p.window_text === 'string' && p.window_text ? p.window_text : null };
}

const quote = (s: string) => `“${s}”`;

function filterOf(d: RequestDetail): FilterKey {
  switch (d.status) {
    case 'cancelled':
      return 'cancelled';
    case 'done':
      return 'done';
    case 'locked':
      return 'locked';
    case 'standby':
      return 'standby';
    default:
      return d.awaitingJonSince ? 'needs' : 'waiting';
  }
}

function captionOf(d: RequestDetail, filter: FilterKey, now: Date): DetailView['caption'] {
  switch (filter) {
    case 'needs': {
      const personal = d.inviteKind === 'personal' ? ` · ${DETAIL.personalLink}` : '';
      const wait = ageLabel(new Date(d.awaitingJonSince!), now);
      return { text: `${DETAIL.needsReply} · `, unit: wait, ...(personal ? { after: personal } : {}) };
    }
    case 'locked':
      return { text: d.countsToward === 'big_day' ? `${DETAIL.locked} · ${DETAIL.bigDay}` : DETAIL.locked };
    case 'cancelled': {
      const how = d.closedInPerson
        ? DETAIL.closedInPerson
        : d.cancelledBy === 'jon'
          ? DETAIL.cancelledByYou
          : DETAIL.cancelledByGuest;
      return { text: d.cancelledAt ? `${how} · ${dayLabel(new Date(d.cancelledAt))}` : how };
    }
    case 'standby':
      return d.standbyWeek
        ? { text: `${DETAIL.standby} · ${INBOX.weekOf(shortDate(vancouverInstant(d.standbyWeek, '12:00')))}` }
        : { text: DETAIL.standby };
    default:
      return { text: DETAIL[filter as Exclude<FilterKey, 'needs' | 'standby'>] };
  }
}

/** Check these (wireframe 09 A2b): who, their email, what they picked, their note. Nothing else. */
function spamView(d: RequestDetail): DetailView {
  const who = d.contact.name.trim() || CHECK.noName;
  const facts: Fact[] = [
    { label: CHECK.email, value: d.contact.email },
    {
      label: CHECK.picked,
      value: d.mode === 'dates' ? ROW.dates(datePrefs(d.datePrefs).dates.length) : ROW.times(d.times.length),
    },
  ];
  if (d.note) facts.push({ label: DETAIL.labels.note, value: quote(d.note), quote: true });
  return {
    who,
    caption: { text: CHECK.caption },
    filter: 'needs',
    back: { href: '/admin?check=1', label: DETAIL.back.requests },
    pageTitle: CHECK.pageTitle,
    facts,
    times: [],
    dates: [],
    open: false,
    flags: [],
    spam: true,
    dateKeys: [],
    pitch: false,
    datesMode: false,
    overnight: false,
    bigDayLocked: false,
    cancelWords: null,
    failed: [],
    joinedTo: null,
    canPromote: false,
  };
}

export function detailView(
  d: RequestDetail,
  now: Date,
  failed: { id: string; resendable: boolean }[] = [],
): DetailView {
  if (d.spamSuspect) return spamView(d);
  const filter = filterOf(d);
  const waiting = filter === 'needs' || filter === 'waiting';
  // Jon (2026-10-04): a stand-by request is acted on like an open one (Lock it in, Suggest another time; canLock
  // allows it), and keeps its own Stand-by tab. No Before 60 box: that one is for after the time together.
  const open = waiting || filter === 'standby';
  const backLabel = waiting ? DETAIL.back.requests : DETAIL.back[filter as keyof typeof DETAIL.back];
  const section = waiting ? DETAIL.back.requests : backLabel;
  const who = d.contact.name;
  const prefs = datePrefs(d.datePrefs);

  const facts: Fact[] = [{ label: DETAIL.labels.dish, value: d.dishName ?? d.dish }];
  if (d.lockedStartsAt && d.lockedEndsAt && !open) {
    const label = filter === 'cancelled' ? DETAIL.labels.was : DETAIL.labels.when;
    facts.push({ label, value: whenLabel(new Date(d.lockedStartsAt), new Date(d.lockedEndsAt)) });
    // R6-L2: the place Jon set at lock time
    if (d.lockedWhere && filter !== 'cancelled')
      facts.push({ label: DETAIL.labels.where, value: d.lockedWhere });
    if (filter === 'locked')
      facts.push({ label: DETAIL.labels.calendar, value: DETAIL.calendarState[d.calendarState] });
  }
  if (d.pitchIdea) facts.push({ label: DETAIL.labels.idea, value: quote(d.pitchIdea), quote: true });
  // QA4 M2: the guest's rough window, on every dated dish (it was only on a pitch), in their words.
  if (prefs.windowText) facts.push({ label: DETAIL.labels.when, value: prefs.windowText });
  // QA4 M1: "one night away" (the guest's words), with their "Which night?" answer when they gave one.
  if (d.overnight)
    facts.push({
      label: DETAIL.labels.away,
      value: d.overnightNight ? `${PITCH.oneNightAway} · ${quote(d.overnightNight)}` : PITCH.oneNightAway,
    });
  if (d.guestTimeZone) facts.push({ label: DETAIL.labels.zone, value: zoneLabel(d.guestTimeZone) }); // QA4 L3
  // R6-L2: Jon wants the head count after locking too (it used to drop off a locked page, A3k)
  if (open || filter === 'locked' || filter === 'done')
    facts.push({ label: DETAIL.labels.crew, value: DETAIL.crew(d.crewSize) });
  if (open && d.inviteKind === 'general') facts.push({ label: DETAIL.labels.link, value: DETAIL.general });
  if (d.hasSealedPlan) facts.push({ label: DETAIL.labels.plan, value: DETAIL.sealed });
  if (d.needToKnow) facts.push({ label: DETAIL.labels.need, value: quote(d.needToKnow), quote: true });
  // QA4b M3: the host's page names who rides on the booking, each a link to their own page.
  if (d.joinedGuests.length && (filter === 'locked' || filter === 'done'))
    facts.push({
      label: DETAIL.labels.with,
      value: d.joinedGuests.map((g) => g.name).join(', '),
      links: d.joinedGuests.map((g) => ({ text: g.name, href: requestHref(g.id) })),
    });
  if (d.note) facts.push({ label: DETAIL.labels.note, value: quote(d.note), quote: true });

  const times = [...d.times].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((t) => timeChoice(t));

  return {
    who,
    caption: captionOf(d, filter, now),
    filter,
    back: { href: waiting ? '/admin' : `/admin#${filter}`, label: backLabel },
    pageTitle: DETAIL.pageTitle(who, section),
    facts,
    times,
    dates: d.mode === 'dates' ? prefs.dates.map((x) => dayLabel(vancouverInstant(x, '12:00'))) : [],
    open,
    flags: flagsOf({ ...d, failedSend: failed.length > 0 }),
    failed,
    spam: false,
    dateKeys: d.mode === 'dates' ? prefs.dates : [],
    pitch: d.dish === 'pitch-me',
    datesMode: d.mode === 'dates' || d.dish === 'pitch-me',
    overnight: d.overnight,
    bigDayLocked: filter === 'locked' && d.countsToward === 'big_day',
    cancelWords:
      filter === 'locked' && d.lockedStartsAt
        ? { dish: dishAfterPossessive(d.dish), day: dayLabel(new Date(d.lockedStartsAt)) }
        : null,
    joinedTo:
      d.joinedHost?.on && (filter === 'locked' || filter === 'done')
        ? { text: SHEETS.join.joined(d.joinedHost.name), href: requestHref(d.joinedHost.id) }
        : null,
    canPromote: Boolean(d.joinedHost && !d.joinedHost.on && d.status === 'needs_new_time'),
  };
}

const requestHref = (id: string) => `/admin/requests/${id}`;

function timeChoice(t: RequestDetail['times'][number]): TimeChoice {
  const week = DETAIL.timeMeta.week(
    shortDate(vancouverInstant(t.week.start, '12:00')),
    t.week.count,
    t.week.cap,
  );
  const base = { slotId: t.slotId, label: whenLabel(new Date(t.startsAt), new Date(t.endsAt)) };
  switch (t.why) {
    case null:
      return { ...base, meta: week, open: true, lockable: true, override: null, nth: null };
    case 'week_full':
      return {
        ...base,
        meta: week,
        open: false,
        lockable: true,
        override: 'overrideWeek',
        nth: t.week.count + 1,
      };
    case 'busy': // a busy calendar is Jon's own call: the lock takes it as is (C3 rule 8 has no busy refusal)
      return { ...base, meta: DETAIL.timeMeta.busy, open: false, lockable: true, override: null, nth: null };
    case 'blocked':
      return {
        ...base,
        meta: DETAIL.timeMeta.blocked,
        open: false,
        lockable: true,
        override: 'bookAnyway',
        nth: null,
      };
    default:
      return {
        ...base,
        meta: DETAIL.timeMeta[t.why],
        open: false,
        lockable: false,
        override: null,
        nth: null,
      };
  }
}
