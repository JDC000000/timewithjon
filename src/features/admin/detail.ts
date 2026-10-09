// src/features/admin/detail.ts — T2.2.03: the A3 request detail (TSD T2.2 "Detail"). Explicit column list only:
// the sealed plan is shown as "Sealed plan on file" through has_sealed_plan and is never selected (C4, T2.2 AC1);
// T2.2.06 guards this file statically. Server-only.
import 'server-only';
import { dishBySlug } from '@/content/menu-helpers';
import type { InviteKind, RequestStatus } from '@/features/availability/types';
import { q } from '@/lib/db';
import { endedSql } from './inbox';
import { type ChosenTime, chosenTimes, iso, noTimesLeft } from './times';

export interface RequestDetail {
  id: string;
  dish: string;
  dishName: string | null;
  mode: 'slots' | 'dates';
  /** A locked request whose end has passed reads as 'done' before the tick materialises it (lazy done, T2.8). */
  status: RequestStatus;
  isTest: boolean;
  spamSuspect: boolean;
  contact: { name: string; email: string; phone: string | null };
  crewSize: number;
  bigCrew: boolean;
  datePrefs: unknown;
  overnight: boolean;
  /** QA4 M1: the guest's "Which night?" answer on an overnight request (Pitch Me), their own words. */
  overnightNight: string | null;
  /** QA4 L3: the zone a Long Distance guest gave (IANA), so Jon sees which clock they're on. */
  guestTimeZone: string | null;
  pitchIdea: string | null;
  needToKnow: string | null;
  note: string | null;
  /** Jon's private notes (T2.8), editable through PATCH /api/admin/requests/[id]. */
  before60Note: string | null;
  jonNote: string | null;
  hasSealedPlan: boolean;
  /** "Also has N other requests": the same guest's other requests that aren't cancelled. */
  otherRequestsCount: number;
  awaitingJonSince: string | null;
  createdAt: string;
  lockedStartsAt: string | null;
  lockedEndsAt: string | null;
  /** The Google event's state; 'failed' = out of retries, the admin must see it (AD-6, pr28 review L5). */
  calendarState: 'none' | 'pending' | 'synced' | 'ics_sent' | 'failed';
  standbyWeek: string | null;
  times: ChosenTime[];
  /** Only a slots-mode request still waiting for a time can run out of them (T2.2 cards). */
  noTimesLeft: boolean;
  // U5 (A3, additive): the facts, flags and actions A3 draws. Never the sealed plan.
  inviteKind: InviteKind;
  countsToward: 'weekly_cap' | 'big_day' | 'none' | null;
  cancelledAt: string | null;
  cancelledBy: 'guest' | 'jon' | null;
  closedInPerson: boolean;
  /** T3.13: "Email bounced: text them". */
  contactProblem: 'bounced' | 'complained' | 'delayed' | null;
  /** T3.15: 'no' = "Can't make it (per Google)". */
  guestRsvp: 'pending' | 'yes' | 'no' | 'maybe' | null;
  /** T2.10: the booking this request is joined to (it shares that time), if any. */
  joinedToRequestId: string | null;
}

interface DetailRow {
  id: string;
  dish: string;
  mode: 'slots' | 'dates';
  status: RequestStatus;
  is_test: boolean;
  spam_suspect: boolean;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  crew_size: number;
  big_crew: boolean;
  date_prefs: unknown;
  overnight: boolean;
  overnight_night: string | null;
  guest_time_zone: string | null;
  pitch_idea: string | null;
  surprise_need_to_know: string | null;
  note: string | null;
  before60_note: string | null;
  jon_note: string | null;
  has_sealed_plan: boolean;
  other_requests: number;
  awaiting_jon_since: Date | null;
  created_at: Date;
  locked_starts_at: Date | null;
  calendar_state: RequestDetail['calendarState'];
  locked_ends_at: Date | null;
  standby_week: string | null;
  invite_kind: InviteKind;
  counts_toward: RequestDetail['countsToward'];
  cancelled_at: Date | null;
  cancelled_by: RequestDetail['cancelledBy'];
  closed_in_person: boolean;
  contact_problem: RequestDetail['contactProblem'];
  guest_rsvp: RequestDetail['guestRsvp'];
  joined_to_request_id: string | null;
}

/** Returns null when there is no such request. */
export async function getRequestDetail(id: string, now = new Date()): Promise<RequestDetail | null> {
  const [r] = await q<DetailRow>(
    `select r.id, r.dish, r.mode,
            case when r.status = 'locked' and coalesce(${endedSql('$2')}, false) then 'done'
                 else r.status::text end as status,
            r.is_test, r.spam_suspect, r.contact_name, r.contact_email::text,
            r.contact_phone, r.crew_size, r.big_crew, r.date_prefs, r.overnight, r.overnight_night,
            r.guest_time_zone, r.pitch_idea,
            r.surprise_need_to_know, r.note, r.before60_note, r.jon_note, r.has_sealed_plan,
            (select count(*)::int from request o
              where o.guest_id = r.guest_id and o.id <> r.id and o.status <> 'cancelled') as other_requests,
            r.awaiting_jon_since, r.created_at, r.locked_starts_at, r.locked_ends_at, r.calendar_state,
            r.standby_week::text, i.kind as invite_kind,
            r.counts_toward, r.cancelled_at, r.cancelled_by, r.closed_in_person, r.contact_problem, r.guest_rsvp,
            r.joined_to_request_id
       from request r join invite i on i.id = r.invite_id
            left join request h on h.id = r.joined_to_request_id
      where r.id = $1`,
    [id, now],
  );
  if (!r) return null;
  const times =
    (await chosenTimes([{ id: r.id, dish: r.dish, inviteKind: r.invite_kind }], now)).get(r.id) ?? [];
  return {
    id: r.id,
    dish: r.dish,
    dishName: dishBySlug(r.dish)?.name ?? null,
    mode: r.mode,
    status: r.status,
    isTest: r.is_test,
    spamSuspect: r.spam_suspect,
    contact: { name: r.contact_name, email: r.contact_email, phone: r.contact_phone },
    crewSize: r.crew_size,
    bigCrew: r.big_crew,
    datePrefs: r.date_prefs,
    overnight: r.overnight,
    overnightNight: r.overnight_night,
    guestTimeZone: r.guest_time_zone,
    pitchIdea: r.pitch_idea,
    needToKnow: r.surprise_need_to_know,
    note: r.note,
    before60Note: r.before60_note,
    jonNote: r.jon_note,
    hasSealedPlan: r.has_sealed_plan,
    otherRequestsCount: r.other_requests,
    awaitingJonSince: iso(r.awaiting_jon_since),
    createdAt: r.created_at.toISOString(),
    lockedStartsAt: iso(r.locked_starts_at),
    lockedEndsAt: iso(r.locked_ends_at),
    calendarState: r.calendar_state,
    standbyWeek: r.standby_week,
    times,
    noTimesLeft: noTimesLeft(r.mode, r.status, times),
    inviteKind: r.invite_kind,
    countsToward: r.counts_toward,
    cancelledAt: iso(r.cancelled_at),
    cancelledBy: r.cancelled_by,
    closedInPerson: r.closed_in_person,
    contactProblem: r.contact_problem,
    guestRsvp: r.guest_rsvp,
    joinedToRequestId: r.joined_to_request_id,
  };
}
