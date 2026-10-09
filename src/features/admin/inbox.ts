// src/features/admin/inbox.ts — T2.2.02: the A2 inbox, one tab at a time (TSD T2.2). Explicit column lists only,
// never `*`: the sealed plan is never selected (C4); T2.2.06 guards this file statically. Server-only.
import 'server-only';
import { dishBySlug } from '@/content/menu-helpers';
import type { InviteKind, RequestStatus } from '@/features/availability/types';
import { q } from '@/lib/db';
import { chosenTimes, iso, noTimesLeft, wantsTimes } from './times';

export const INBOX_TABS = [
  'needs_reply',
  'waiting',
  'locked',
  'standby',
  'done',
  'cancelled',
  'check',
] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

/**
 * Tab membership. Spam suspects appear only in Check these (AC4); anything Jon owes a reply is in Needs a reply
 * (AC5); a needs_new_time request is in Needs a reply or Waiting on them, never both (AC6). A locked request
 * whose end has passed is Done (lazy done, T2.8); a joined request (no range of its own) ends with its host, h
 * (AD-8, as materialise-done.ts). $1 is "now".
 */
const END = `coalesce(h.locked_ends_at, r.locked_ends_at)`;
/**
 * Lazy done, shared with the A5 invite list (invites.ts) and the A3 detail (detail.ts) so they never disagree.
 * Aliases r/h; `now` is the placeholder of the "now" parameter.
 */
export const endedSql = (now: string) => `(h.status = 'done' or ${END} <= ${now})`;
/** endedSql with $1 = now. */
export const ENDED = endedSql('$1');
/**
 * QA4b M3: a guest riding on a booking (locked or done, no range of its own, rule 1) has the host's time: the A2
 * row and the A3 detail both read it, so they never disagree. Aliases r/h.
 */
export const sharedTime = (col: 'locked_starts_at' | 'locked_ends_at') =>
  `case when r.locked_starts_at is null and r.status in ('locked', 'done') then h.${col} else r.${col} end`;
const TAB_WHERE: Record<InboxTab, string> = {
  needs_reply: `r.awaiting_jon_since is not null and not r.spam_suspect`,
  waiting: `r.status = 'needs_new_time' and r.awaiting_jon_since is null and not r.spam_suspect`,
  locked: `r.status = 'locked' and not coalesce(${ENDED}, false) and not r.spam_suspect`,
  standby: `r.status = 'standby' and not r.spam_suspect`,
  done: `(r.status = 'done' or (r.status = 'locked' and coalesce(${ENDED}, false))) and not r.spam_suspect`,
  cancelled: `r.status = 'cancelled' and not r.spam_suspect`,
  check: `r.spam_suspect`,
};

const TAB_ORDER: Record<InboxTab, string> = {
  needs_reply: `r.awaiting_jon_since asc`, // the longest wait first
  waiting: `r.created_at asc`,
  locked: `${sharedTime('locked_starts_at')} asc nulls last`,
  standby: `r.standby_week asc nulls last, r.created_at asc`,
  done: `${sharedTime('locked_starts_at')} desc nulls last, r.created_at desc`,
  cancelled: `r.cancelled_at desc nulls last`,
  check: `r.created_at asc`,
};

export interface InboxCard {
  id: string;
  dish: string;
  dishName: string | null;
  mode: 'slots' | 'dates';
  status: RequestStatus;
  isTest: boolean;
  contactName: string;
  crewSize: number;
  bigCrew: boolean;
  awaitingJonSince: string | null;
  createdAt: string;
  lockedStartsAt: string | null;
  lockedEndsAt: string | null;
  standbyWeek: string | null;
  noTimesLeft: boolean;
  // U5 (A2 rows, additive): what the row meta and flags need. Never the sealed plan.
  /** Slots mode: how many times they picked. Dates mode: how many dates they asked for. */
  timesCount: number;
  datesCount: number;
  /** A pitch's "when" in the guest's words ("sometime in June"). */
  windowText: string | null;
  /** QA4 M1: the guest said it's one night away. */
  overnight: boolean;
  countsToward: 'weekly_cap' | 'big_day' | 'none' | null;
  inviteKind: InviteKind;
  cancelledAt: string | null;
  cancelledBy: 'guest' | 'jon' | null;
  closedInPerson: boolean;
  /** T3.13: the guest's email bounced / complained / was delayed ("Email bounced: text them"). */
  contactProblem: 'bounced' | 'complained' | 'delayed' | null;
  /** T3.15: the guest's answer in Google Calendar; 'no' = "Can't make it (per Google)". */
  guestRsvp: 'pending' | 'yes' | 'no' | 'maybe' | null;
}

interface CardRow {
  id: string;
  dish: string;
  mode: 'slots' | 'dates';
  status: RequestStatus;
  is_test: boolean;
  contact_name: string;
  crew_size: number;
  big_crew: boolean;
  awaiting_jon_since: Date | null;
  created_at: Date;
  locked_starts_at: Date | null;
  locked_ends_at: Date | null;
  standby_week: string | null;
  invite_kind: InviteKind;
  times_count: number;
  dates_count: number;
  window_text: string | null;
  overnight: boolean;
  counts_toward: InboxCard['countsToward'];
  cancelled_at: Date | null;
  cancelled_by: InboxCard['cancelledBy'];
  closed_in_person: boolean;
  contact_problem: InboxCard['contactProblem'];
  guest_rsvp: InboxCard['guestRsvp'];
}

/** No tab is unbounded: Done and Cancelled grow all season. A2 says "showing the latest 300" when truncated. */
export const INBOX_LIMIT = 300;

export async function listRequests(
  tab: InboxTab,
  now = new Date(),
): Promise<{ cards: InboxCard[]; truncated: boolean }> {
  const fetched = await q<CardRow>(
    `select r.id, r.dish, r.mode, r.status, r.is_test, r.contact_name, r.crew_size, r.big_crew,
            r.awaiting_jon_since, r.created_at, ${sharedTime('locked_starts_at')} as locked_starts_at,
            ${sharedTime('locked_ends_at')} as locked_ends_at, r.standby_week::text,
            i.kind as invite_kind,
            (select count(*)::int from request_slot_choice c where c.request_id = r.id) as times_count,
            coalesce(case when jsonb_typeof(r.date_prefs -> 'dates') = 'array'
                          then jsonb_array_length(r.date_prefs -> 'dates') end, 0) as dates_count,
            nullif(r.date_prefs ->> 'window_text', '') as window_text, r.overnight,
            r.counts_toward, r.cancelled_at, r.cancelled_by, r.closed_in_person, r.contact_problem, r.guest_rsvp
       from request r join invite i on i.id = r.invite_id
       left join request h on h.id = r.joined_to_request_id
      where ${TAB_WHERE[tab]}
      order by ${TAB_ORDER[tab]}, r.id
      limit ${INBOX_LIMIT + 1}`,
    TAB_WHERE[tab].includes('$1') ? [now] : [], // only Locked in and Done depend on the time
  );
  const truncated = fetched.length > INBOX_LIMIT;
  const rows = fetched.slice(0, INBOX_LIMIT);
  const times = await chosenTimes(
    rows
      .filter((r) => wantsTimes(r.mode, r.status))
      .map((r) => ({ id: r.id, dish: r.dish, inviteKind: r.invite_kind })),
    now,
  );
  const cards = rows.map((r) => ({
    id: r.id,
    dish: r.dish,
    dishName: dishBySlug(r.dish)?.name ?? null,
    mode: r.mode,
    status: r.status,
    isTest: r.is_test,
    contactName: r.contact_name,
    crewSize: r.crew_size,
    bigCrew: r.big_crew,
    awaitingJonSince: iso(r.awaiting_jon_since),
    createdAt: r.created_at.toISOString(),
    lockedStartsAt: iso(r.locked_starts_at),
    lockedEndsAt: iso(r.locked_ends_at),
    standbyWeek: r.standby_week,
    noTimesLeft: noTimesLeft(r.mode, r.status, times.get(r.id) ?? []),
    timesCount: r.times_count,
    datesCount: r.dates_count,
    windowText: r.window_text,
    overnight: r.overnight,
    countsToward: r.counts_toward,
    inviteKind: r.invite_kind,
    cancelledAt: iso(r.cancelled_at),
    cancelledBy: r.cancelled_by,
    closedInPerson: r.closed_in_person,
    contactProblem: r.contact_problem,
    guestRsvp: r.guest_rsvp,
  }));
  return { cards, truncated };
}
