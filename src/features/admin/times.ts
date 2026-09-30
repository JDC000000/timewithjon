// src/features/admin/times.ts — T2.2.02/.03: each time a guest picked, marked open or gone by the C3 engine
// (isSlotOpen), so the inbox card and the detail agree. Server-only.
import 'server-only';
import { dishBySlug } from '@/content/menu-helpers';
import { getBusy } from '@/features/availability/busy';
import { engineInput, loadEngineData } from '@/features/availability/load';
import { isSlotOpen } from '@/features/availability/openWindows';
import {
  bigDayDates,
  busyClash,
  capFor,
  heldByOffer,
  HOUSEHOLD_HOLD,
  inSeason,
  isWeekFull,
  overlaps,
  rangedBookings,
  weekCapCount,
  windowBlock,
} from '@/features/availability/rules';
import type { EngineInput, InviteKind, RequestStatus, Slot, WindowKind } from '@/features/availability/types';
import { q } from '@/lib/db';
import { weekStartOf } from '@/lib/time';

export interface ChosenTime {
  slotId: string;
  date: string;
  windowKind: WindowKind;
  startsAt: string;
  endsAt: string;
  state: 'open' | 'gone';
  /** U5 (A3, additive): why a gone time is gone, in the engine's own order (C3 rule 2); null when open. */
  why: GoneReason | null;
  /** U5 (A3 "Week of May 10 · 1 of 2"): the slot's Mon–Sun week, its weekly-cap bookings and its cap. */
  week: { start: string; count: number; cap: number };
}

/**
 * past = out of season or started · blocked = Jon's block, away or the household hold · taken = another booking,
 * a Big Day or a live offer holds it · busy = Jon's calendar · week_full = the week's cap is met · window = the
 * dish doesn't use this window. blocked/busy can be booked anyway and week_full overridden (T2.3 lock flags).
 */
export type GoneReason = 'past' | 'blocked' | 'taken' | 'busy' | 'week_full' | 'window';

/** isSlotOpen's rules, one by one, naming the first that closes the slot (null = open). Keep in step with it. */
export function goneReason(slot: Slot, input: EngineInput, bigDays: Set<string>): GoneReason | null {
  const { settings: s, now } = input;
  const range = { startsAt: slot.startsAt, endsAt: slot.endsAt };
  if (!inSeason(slot.date, s) || slot.startsAt <= now) return 'past';
  if (windowBlock(slot, input.blocks)) return 'blocked';
  if (
    !s.householdHoldReleased &&
    slot.date === HOUSEHOLD_HOLD.date &&
    slot.windowKind === HOUSEHOLD_HOLD.windowKind
  )
    return 'blocked';
  if (rangedBookings(input.bookings).some((b) => overlaps(b, range))) return 'taken';
  if (bigDays.has(slot.date)) return 'taken';
  if (heldByOffer(slot.id, range, input.offers, now, input.viewerRequestId)) return 'taken';
  if (busyClash(range, input.busy)) return 'busy';
  if (isWeekFull(weekStartOf(slot.date), input.bookings, input.weeks, s)) return 'week_full';
  return input.dishWindows.includes(slot.windowKind) ? null : 'window';
}

export interface TimesSubject {
  id: string;
  dish: string;
  inviteKind: InviteKind;
}

/** Loads the engine once (only if anyone picked a time) and returns each request's times, keyed by request id. */
export async function chosenTimes(
  subjects: TimesSubject[],
  now = new Date(),
): Promise<Map<string, ChosenTime[]>> {
  const out = new Map<string, ChosenTime[]>(subjects.map((s) => [s.id, []]));
  if (subjects.length === 0) return out;
  const choices = await q<{ request_id: string; slot_id: string }>(
    `select request_id, slot_id from request_slot_choice where request_id = any($1::uuid[])`,
    [subjects.map((s) => s.id)],
  );
  if (choices.length === 0) return out;

  const loaded = await loadEngineData(now);
  const busy = await getBusy({ start: loaded.settings.seasonStart, end: loaded.settings.seasonEnd }, now);
  const slotsById = new Map(loaded.slots.map((s) => [s.id, s]));
  for (const subject of subjects) {
    // The request's own booking and its own offers never make its times gone.
    const bookings = loaded.bookings.filter((b) => b.requestId !== subject.id);
    const input = engineInput(
      { ...loaded, bookings },
      busy,
      subject.inviteKind,
      dishBySlug(subject.dish)?.windows ?? [],
      subject.id,
    );
    const bigDays = bigDayDates(bookings);
    const slots = choices
      .filter((c) => c.request_id === subject.id)
      .map((c) => slotsById.get(c.slot_id))
      .filter((s): s is Slot => s !== undefined)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    out.set(
      subject.id,
      slots.map((slot) => ({
        slotId: slot.id,
        date: slot.date,
        windowKind: slot.windowKind,
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        state: isSlotOpen(slot, input, bigDays) ? 'open' : 'gone',
        why: goneReason(slot, input, bigDays),
        week: {
          start: weekStartOf(slot.date),
          count: weekCapCount(weekStartOf(slot.date), input.bookings),
          cap: capFor(weekStartOf(slot.date), input.weeks, input.settings),
        },
      })),
    );
  }
  return out;
}

/** Only a slots-mode request still waiting for a time can run out of times. */
export function wantsTimes(mode: 'slots' | 'dates', status: RequestStatus): boolean {
  return mode === 'slots' && (status === 'requested' || status === 'needs_new_time');
}

/** The "no times left" flag (TSD T2.2 cards): every time the guest picked has gone. */
export function noTimesLeft(mode: 'slots' | 'dates', status: RequestStatus, times: ChosenTime[]): boolean {
  return wantsTimes(mode, status) && times.every((t) => t.state === 'gone');
}

export const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
