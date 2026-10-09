// src/features/admin/options.ts — U5 (Q2 ruling, a small read): what A3's sheets can offer for one request, from
// the C3 engine so they agree with the picker: the open times (Suggest another time), the weeks and
// their state (Move to stand-by), and the locked bookings this request's picks overlap (Join). Reads only; the
// sealed plan is never selected. Server-only; every caller has passed requireAdmin().
// QA r2 M3: a dates-mode request's weeks are its own dates' weeks first, with the engine's date-dish state
// (dateWeekStatus), never the Thu/Fri slot state a date dish can't use.
import 'server-only';
import { dishBySlug } from '@/content/menu-helpers';
import { getBusy } from '@/features/availability/busy';
import { engineInput, loadEngineData, withoutOwnBooking } from '@/features/availability/load';
import { dateWeekStatus, isSlotOpen, weekStatus } from '@/features/availability/openWindows';
import { bigDayDates, dateRuleAllows, inSeason } from '@/features/availability/rules';
import type { CountsToward, InviteKind, WeekState } from '@/features/availability/types';
import { q } from '@/lib/db';
import { addDays, vancouverDate, weekStartOf } from '@/lib/time';

/** How many open times a sheet lists (the next ones, earliest first). */
export const OPEN_TIMES_LIMIT = 12;
/** How many weeks the stand-by sheet lists, from the week of their first pick. */
export const STANDBY_WEEKS = 3;

export interface OpenTime {
  slotId: string;
  startsAt: string;
  endsAt: string;
}
export interface WeekOption {
  weekStart: string;
  /** The week's first and last bookable dates: Thu/Fri for a time dish ("May 13–14"), the dish's days otherwise. */
  firstDate: string;
  lastDate: string;
  state: WeekState;
}
export interface JoinHost {
  hostId: string;
  name: string;
  startsAt: string;
  endsAt: string;
}
export interface RequestOptions {
  openTimes: OpenTime[];
  weeks: WeekOption[];
  joinHosts: JoinHost[];
}

interface Row {
  dish: string;
  mode: 'slots' | 'dates';
  counts_toward: CountsToward;
  date_prefs: { dates?: string[] } | null;
  invite_kind: InviteKind;
  locked_slot_id: string | null;
  picks: string[];
}

/** Null when there is no such request. */
export async function requestOptions(id: string, now = new Date()): Promise<RequestOptions | null> {
  const [r] = await q<Row>(
    `select r.dish, r.mode::text as mode, r.counts_toward::text as counts_toward, r.date_prefs,
            i.kind as invite_kind, r.locked_slot_id,
            coalesce(array(select c.slot_id from request_slot_choice c where c.request_id = r.id), '{}') as picks
       from request r join invite i on i.id = r.invite_id
      where r.id = $1`,
    [id],
  );
  if (!r) return null;

  const loaded = withoutOwnBooking(await loadEngineData(now), id);
  const busy = await getBusy({ start: loaded.settings.seasonStart, end: loaded.settings.seasonEnd }, now);
  const input = engineInput(loaded, busy, r.invite_kind, dishBySlug(r.dish)?.windows ?? [], id);
  const bigDays = bigDayDates(loaded.bookings);
  const skip = new Set([...r.picks, ...(r.locked_slot_id ? [r.locked_slot_id] : [])]);
  const slots = [...loaded.slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const openTimes = slots
    .filter((s) => s.startsAt > now && !skip.has(s.id) && isSlotOpen(s, input, bigDays))
    .slice(0, OPEN_TIMES_LIMIT)
    .map((s) => ({ slotId: s.id, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() }));

  const weeks =
    r.mode === 'dates'
      ? dateWeeks(r, input, bigDays)
      : slotWeeks(
          slots,
          slots.filter((s) => r.picks.includes(s.id)),
          now,
          (w) => weekStatus(w, input, bigDays).state,
          loaded.settings.seasonStart,
        );

  const joinHosts = await q<{
    id: string;
    contact_name: string;
    locked_starts_at: Date;
    locked_ends_at: Date;
  }>(
    `select distinct h.id, h.contact_name, h.locked_starts_at, h.locked_ends_at
       from request h
       join slot s on s.id = any($2::uuid[])
      where h.id <> $1 and h.status = 'locked' and h.joined_to_request_id is null
        and h.locked_ends_at > $3
        and tstzrange(h.locked_starts_at, h.locked_ends_at) && tstzrange(s.starts_at, s.ends_at)
      order by h.locked_starts_at`,
    [id, r.picks, now],
  );

  return {
    openTimes,
    weeks,
    joinHosts: joinHosts.map((h) => ({
      hostId: h.id,
      name: h.contact_name,
      startsAt: h.locked_starts_at.toISOString(),
      endsAt: h.locked_ends_at.toISOString(),
    })),
  };
}

type Slots = Awaited<ReturnType<typeof loadEngineData>>['slots'];

/** A time dish: the Thu/Fri weeks from the week of its first pick (or the next open slot). */
function slotWeeks(
  slots: Slots,
  picked: Slots,
  now: Date,
  state: (weekStart: string) => WeekState,
  seasonStart: string,
): WeekOption[] {
  const firstWeek = weekStartOf(picked[0]?.date ?? slots.find((s) => s.startsAt > now)?.date ?? seasonStart);
  return [...new Set(slots.map((s) => weekStartOf(s.date)))]
    .filter((w) => w >= firstWeek)
    .slice(0, STANDBY_WEEKS)
    .map((w) => {
      const dates = slots.filter((s) => weekStartOf(s.date) === w).map((s) => s.date);
      return { weekStart: w, firstDate: dates[0]!, lastDate: dates.at(-1)!, state: state(w) };
    });
}

/**
 * A date dish (QA r2 M3): the weeks of the guest's own dates first, then the season's next weeks (at least
 * STANDBY_WEEKS rows), each with the engine's date-dish state and its first and last day the dish allows.
 */
function dateWeeks(
  r: Pick<Row, 'dish' | 'counts_toward' | 'date_prefs'>,
  input: ReturnType<typeof engineInput>,
  bigDays: Set<string>,
): WeekOption[] {
  const dish = dishBySlug(r.dish);
  const days = (w: string) =>
    Array.from({ length: 7 }, (_, i) => addDays(w, i)).filter(
      (d) => inSeason(d, input.settings) && dateRuleAllows(dish?.dateRule, d),
    );
  const season = input.weeks
    .map((w) => w.weekStart)
    .filter((w) => days(w).length > 0)
    .sort();
  const own = [...new Set((r.date_prefs?.dates ?? []).map(weekStartOf))]
    .filter((w) => season.includes(w))
    .sort();
  const thisWeek = weekStartOf(vancouverDate(input.now));
  const rest = season.filter((w) => (own.length ? w > own.at(-1)! : w >= thisWeek) && !own.includes(w));
  return [...own, ...rest].slice(0, Math.max(STANDBY_WEEKS, own.length)).map((w) => {
    const dates = days(w);
    return {
      weekStart: w,
      firstDate: dates[0]!,
      lastDate: dates.at(-1)!,
      state: dateWeekStatus(
        w,
        input,
        {
          countsToward: r.counts_toward,
          dateRule: dish?.dateRule,
          slug: r.dish,
          maxPerWeek: dish?.maxPerWeek,
        },
        bigDays,
      ),
    };
  });
}
