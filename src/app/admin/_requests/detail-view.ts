// src/app/admin/_requests/detail-view.ts — how one request reads on A3 (pack a3; wireframe 09 A3, A3g, A3h, A3j,
// A3k): the caption, where "‹" goes back to, the facts list, and their times or dates. Pure (the page passes now).
// The sealed plan is never here: only `hasSealedPlan` (C4, AD-11).
import { CHECK, DETAIL, INBOX, ROW } from '@/content/ui/admin-requests';
import type { RequestDetail } from '@/features/admin/detail';
import { dayLabel, vancouverInstant } from '@/lib/time';
import { ageLabel, shortDate, whenLabel } from './format';
import { flagsOf, type FilterKey } from './rows';

export interface Fact {
  label: string;
  value: string;
  /** A guest's own words, set as a quote ("“…”"). */
  quote?: boolean;
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
  /** Jon-only flags (bounce, RSVP no, no times left, big crew), as rows over the facts. */
  flags: string[];
  /** A possible spam request (Check these, A2b): Not spam / Delete instead of the lock bar. */
  spam: boolean;
  /** Dates mode: their dates as YYYY-MM-DD (the Lock sheet's options). */
  dateKeys: string[];
  /** A Pitch Me request: "About your pitch" is the fill, "Lock in…" opens the dates sheet (wireframe 09 A3h). */
  pitch: boolean;
  /** A locked Big Day: the weather call applies (wireframe 09 A3m). */
  bigDayLocked: boolean;
  /** "Cancel Sam's Old Haunt, Thu May 13?": the dish without a leading "The" and the locked day (wireframe 09 A3l). */
  cancelWords: { dish: string; day: string } | null;
  /** T3.2.U1: this request's emails that failed for good; each may offer Resend. */
  failed: { id: string; resendable: boolean }[];
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
    bigDayLocked: false,
    cancelWords: null,
    failed: [],
  };
}

export function detailView(
  d: RequestDetail,
  now: Date,
  failed: { id: string; resendable: boolean }[] = [],
): DetailView {
  if (d.spamSuspect) return spamView(d);
  const filter = filterOf(d);
  const open = filter === 'needs' || filter === 'waiting';
  const backLabel = open ? DETAIL.back.requests : DETAIL.back[filter as keyof typeof DETAIL.back];
  const section = open ? DETAIL.back.requests : backLabel;
  const who = d.contact.name;
  const prefs = datePrefs(d.datePrefs);

  const facts: Fact[] = [{ label: DETAIL.labels.dish, value: d.dishName ?? d.dish }];
  if (d.lockedStartsAt && d.lockedEndsAt && !open) {
    const label = filter === 'cancelled' ? DETAIL.labels.was : DETAIL.labels.when;
    facts.push({ label, value: whenLabel(new Date(d.lockedStartsAt), new Date(d.lockedEndsAt)) });
    if (filter === 'locked')
      facts.push({ label: DETAIL.labels.calendar, value: DETAIL.calendarState[d.calendarState] });
  }
  if (d.pitchIdea) facts.push({ label: DETAIL.labels.idea, value: quote(d.pitchIdea), quote: true });
  if (d.pitchIdea && prefs.windowText) facts.push({ label: DETAIL.labels.when, value: prefs.windowText });
  if (open) facts.push({ label: DETAIL.labels.crew, value: DETAIL.crew(d.crewSize) }); // a locked page drops it (A3k)
  if (open && d.inviteKind === 'general') facts.push({ label: DETAIL.labels.link, value: DETAIL.general });
  if (d.hasSealedPlan) facts.push({ label: DETAIL.labels.plan, value: DETAIL.sealed });
  if (d.needToKnow) facts.push({ label: DETAIL.labels.need, value: quote(d.needToKnow), quote: true });
  if (d.note) facts.push({ label: DETAIL.labels.note, value: quote(d.note), quote: true });

  const times = [...d.times].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((t) => timeChoice(t));

  return {
    who,
    caption: captionOf(d, filter, now),
    filter,
    back: { href: open ? '/admin' : `/admin#${filter}`, label: backLabel },
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
    bigDayLocked: filter === 'locked' && d.countsToward === 'big_day',
    cancelWords:
      filter === 'locked' && d.lockedStartsAt
        ? { dish: (d.dishName ?? d.dish).replace(/^The /, ''), day: dayLabel(new Date(d.lockedStartsAt)) }
        : null,
  };
}

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
