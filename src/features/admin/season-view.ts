// src/features/admin/season-view.ts — T2.5.03: the A4 season view query (TSD T2.5). Per week: the locked and done
// bookings, the pending taps, the stand-by list, the blocks and the cap (override, effective cap, how much is
// used) and, from T3.5.02, the "Busy on main calendar" markers (busy-markers.ts). Spam suspects are not listed (they live in Check
// these), but a locked one still counts toward the cap, exactly as the engine counts it (load.ts). Only the 14
// seeded weeks are read. Explicit column lists only, never `*`: the sealed plan is never selected (C4).
// Server-only.
import 'server-only';
import { dishBySlug } from '@/content/menu-helpers';
import type { Booking, CountsToward, WindowKind } from '@/features/availability/types';
import { readBusy } from '@/features/availability/busy';
import { capFor, weekCapCount } from '@/features/availability/rules';
import { q } from '@/lib/db';
import { loadSettings, toEngineSettings } from '@/lib/settings';
import { addDays, vancouverInstant } from '@/lib/time';
import { busyMarkers, type BusyMarker } from './busy-markers';

/** A request's local week (Monday), the same Vancouver week the engine uses (rule 1). */
const WEEK_OF = (instant: string) =>
  `date_trunc('week', (${instant}) at time zone 'America/Vancouver')::date::text`;
/** The seeded season weeks as a local-date range [first Monday, last Monday + 7). */
const FIRST_DAY = `(select min(week_start) from week)`;
const END_DAY = `(select max(week_start) + 7 from week)`;
const AT_VANCOUVER = (d: string) => `${d}::timestamp at time zone 'America/Vancouver'`;

interface Who {
  id: string;
  contactName: string;
  dish: string;
  dishName: string | null;
  isTest: boolean;
}
export interface SeasonBooking extends Who {
  /** Lazy done (T2.8): a locked booking whose end has passed shows as done before the tick materialises it. */
  status: 'locked' | 'done';
  startsAt: string;
  endsAt: string;
  countsToward: CountsToward;
  joinedGuests: number;
}
export interface PendingTap extends Who {
  taps: { slotId: string; startsAt: string; window: WindowKind }[];
}
export interface StandbyEntry extends Who {
  createdAt: string;
}
export interface SeasonBlock {
  id: string;
  startDate: string;
  endDate: string;
  kind: 'blocked' | 'away';
  confirmBy: string | null;
  note: string | null;
  /** T2.5.06: set only on a block of one window of startDate; absent = the whole day(s), as before. */
  window?: WindowKind;
}
export interface SeasonWeek {
  weekStart: string;
  capOverride: number | null;
  cap: number;
  capUsed: number;
  bookings: SeasonBooking[];
  pendingTaps: PendingTap[];
  standby: StandbyEntry[];
  blocks: SeasonBlock[];
  /** T3.5.02: time busy on Jon's main calendar this week, other than the app's own bookings. */
  busy: BusyMarker[];
}
export interface SeasonView {
  defaultWeeklyCap: number;
  householdHoldReleased: boolean;
  /** 'unavailable' = free/busy couldn't be read and there's no usable cache: no markers (fails open, C3 rule 7). */
  mainCalendar: 'ok' | 'unavailable';
  /**
   * pr62 L1: when the markers were read from Google (ISO), null when unavailable. It can be up to 10 min old, or
   * up to 24 h while Google is failing (the cache is served): U1 shows "as of" when it's older than 10 min.
   */
  mainCalendarAsOf: string | null;
  weeks: SeasonWeek[];
}

const who = (r: { id: string; contact_name: string; dish: string; is_test: boolean }): Who => ({
  id: r.id,
  contactName: r.contact_name,
  dish: r.dish,
  dishName: dishBySlug(r.dish)?.name ?? null,
  isTest: r.is_test,
});

export async function seasonView(now = new Date()): Promise<SeasonView> {
  // pr62 L2: free/busy (maybe a Google call) runs beside the DB reads; it needs only the season from settings.
  const settingsRead = loadSettings();
  const busyRead = settingsRead.then((s) => readBusy({ start: s.season_start, end: s.season_end }, now));
  const [settings, weeks, bookings, taps, standby, blocks, { busy, fetchedAt }] = await Promise.all([
    settingsRead,
    q<{ week_start: string; cap_override: number | null }>(
      `select week_start::text, cap_override from week order by week_start`,
    ),
    q<{
      id: string;
      contact_name: string;
      dish: string;
      is_test: boolean;
      status: 'locked' | 'done';
      locked_starts_at: Date;
      locked_ends_at: Date;
      counts_toward: CountsToward;
      joined: number;
      spam_suspect: boolean;
      week_start: string;
    }>(
      `select r.id, r.contact_name, r.dish, r.is_test, r.status, r.locked_starts_at, r.locked_ends_at,
              r.counts_toward, r.spam_suspect, ${WEEK_OF('r.locked_starts_at')} as week_start,
              (select count(*)::int from request j
                where j.joined_to_request_id = r.id and j.status in ('locked', 'done')) as joined
         from request r
        where r.status in ('locked', 'done') and r.joined_to_request_id is null
          and r.locked_starts_at >= ${AT_VANCOUVER(FIRST_DAY)} and r.locked_starts_at < ${AT_VANCOUVER(END_DAY)}
        order by r.locked_starts_at, r.id`,
    ),
    q<{
      id: string;
      contact_name: string;
      dish: string;
      is_test: boolean;
      slot_id: string;
      starts_at: Date;
      window_kind: WindowKind;
      week_start: string;
    }>(
      `select r.id, r.contact_name, r.dish, r.is_test, s.id as slot_id, s.starts_at, s.window_kind,
              date_trunc('week', s.date)::date::text as week_start
         from request r
         join request_slot_choice c on c.request_id = r.id
         join slot s on s.id = c.slot_id
        where r.status = 'requested' and not r.spam_suspect
          and s.date >= ${FIRST_DAY} and s.date < ${END_DAY}
        order by r.created_at, r.id, s.starts_at`,
    ),
    q<{
      id: string;
      contact_name: string;
      dish: string;
      is_test: boolean;
      created_at: Date;
      week_start: string;
    }>(
      `select id, contact_name, dish, is_test, created_at, standby_week::text as week_start
         from request
        where status = 'standby' and standby_week is not null and not spam_suspect -- standby_week → week (FK)
        order by created_at, id`,
    ),
    q<{
      id: string;
      start_date: string;
      end_date: string;
      kind: 'blocked' | 'away';
      confirm_by: string | null;
      note: string | null;
      window_kind: WindowKind | null;
    }>(
      `select id, start_date::text, end_date::text, kind, confirm_by::text, note, window_kind
         from availability_block order by start_date, id`,
    ),
    // Same season range as the guest picker, so both share the one freebusy_cache row and its cooldown.
    busyRead,
  ]);

  const ownBookings = bookings.map((b) => ({ start: b.locked_starts_at, end: b.locked_ends_at }));

  const engineSettings = toEngineSettings(settings);
  const engineWeeks = weeks.map((w) => ({ weekStart: w.week_start, capOverride: w.cap_override }));
  const engineBookings = bookings.map((b): Booking => ({
    requestId: b.id,
    startsAt: b.locked_starts_at,
    endsAt: b.locked_ends_at,
    countsToward: b.counts_toward,
    joinedToRequestId: null,
  }));

  return {
    defaultWeeklyCap: settings.default_weekly_cap,
    householdHoldReleased: settings.household_hold_released,
    mainCalendar: busy ? 'ok' : 'unavailable',
    mainCalendarAsOf: fetchedAt?.toISOString() ?? null,
    weeks: weeks.map((w): SeasonWeek => {
      const weekEnd = addDays(w.week_start, 6);
      const pending = new Map<string, PendingTap>();
      for (const t of taps.filter((x) => x.week_start === w.week_start)) {
        const entry = pending.get(t.id) ?? { ...who(t), taps: [] };
        entry.taps.push({ slotId: t.slot_id, startsAt: t.starts_at.toISOString(), window: t.window_kind });
        pending.set(t.id, entry);
      }
      return {
        weekStart: w.week_start,
        capOverride: w.cap_override,
        cap: capFor(w.week_start, engineWeeks, engineSettings),
        capUsed: weekCapCount(w.week_start, engineBookings),
        bookings: bookings
          .filter((b) => b.week_start === w.week_start && !b.spam_suspect)
          .map((b) => ({
            ...who(b),
            status: b.status === 'done' || b.locked_ends_at <= now ? 'done' : 'locked',
            startsAt: b.locked_starts_at.toISOString(),
            endsAt: b.locked_ends_at.toISOString(),
            countsToward: b.counts_toward,
            joinedGuests: b.joined,
          })),
        pendingTaps: [...pending.values()],
        standby: standby
          .filter((s) => s.week_start === w.week_start)
          .map((s) => ({ ...who(s), createdAt: s.created_at.toISOString() })),
        blocks: blocks
          .filter((b) => b.start_date <= weekEnd && b.end_date >= w.week_start)
          .map((b) => ({
            id: b.id,
            startDate: b.start_date,
            endDate: b.end_date,
            kind: b.kind,
            confirmBy: b.confirm_by,
            note: b.note,
            ...(b.window_kind ? { window: b.window_kind } : {}),
          })),
        busy: busyMarkers(
          busy ?? [],
          ownBookings,
          vancouverInstant(w.week_start, '00:00'),
          vancouverInstant(addDays(w.week_start, 7), '00:00'),
        ),
      };
    }),
  };
}
