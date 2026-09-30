// src/features/admin/options.ts — U5 (Q2 ruling, a small read): what A3's sheets can offer for one request, from
// the C3 engine so they agree with the picker: the open times (Suggest another time), the weeks and
// their state (Move to stand-by), and the locked bookings this request's picks overlap (Join). Reads only; the
// sealed plan is never selected. Server-only; every caller has passed requireAdmin().
import 'server-only';
import { dishBySlug } from '@/content/menu-helpers';
import { getBusy } from '@/features/availability/busy';
import { engineInput, loadEngineData, withoutOwnBooking } from '@/features/availability/load';
import { isSlotOpen, weekStatus } from '@/features/availability/openWindows';
import { bigDayDates } from '@/features/availability/rules';
import type { InviteKind, WeekState } from '@/features/availability/types';
import { q } from '@/lib/db';
import { weekStartOf } from '@/lib/time';

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
  /** The week's first and last bookable dates (Thu/Fri): "May 13–14". */
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
  invite_kind: InviteKind;
  locked_slot_id: string | null;
  picks: string[];
}

/** Null when there is no such request. */
export async function requestOptions(id: string, now = new Date()): Promise<RequestOptions | null> {
  const [r] = await q<Row>(
    `select r.dish, i.kind as invite_kind, r.locked_slot_id,
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

  const picked = slots.filter((s) => r.picks.includes(s.id));
  const firstWeek = weekStartOf(
    picked[0]?.date ?? slots.find((s) => s.startsAt > now)?.date ?? loaded.settings.seasonStart,
  );
  const weekStarts = [...new Set(slots.map((s) => weekStartOf(s.date)))]
    .filter((w) => w >= firstWeek)
    .slice(0, STANDBY_WEEKS);
  const weeks = weekStarts.map((w) => {
    const dates = slots.filter((s) => weekStartOf(s.date) === w).map((s) => s.date);
    return {
      weekStart: w,
      firstDate: dates[0]!,
      lastDate: dates.at(-1)!,
      state: weekStatus(w, input, bigDays).state,
    };
  });

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
