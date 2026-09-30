// src/lib/engine/openWindows.ts — C3 rules 1–2, 10, 11. Pure.
import { addDays, vancouverDate, weekStartOf, windowLabel } from '@/lib/time';
import {
  bigDayDates,
  blockCovering,
  busyClash,
  heldByOffer,
  HOUSEHOLD_HOLD,
  inSeason,
  isWeekFull,
  overlaps,
  rangedBookings,
  windowBlock,
} from './rules';
import type { EngineInput, EngineOutput, Slot, WeekOut, WeekState } from './types';

export function opensAtFor(input: Pick<EngineInput, 'inviteKind' | 'settings'>): Date {
  return input.inviteKind === 'personal' ? input.settings.personalOpenAt : input.settings.generalOpenAt;
}

/** Rule 2 (a)–(i) for one slot. Release time (a) is applied per week in weekStatus. */
export function isSlotOpen(slot: Slot, input: EngineInput, bigDays: Set<string>): boolean {
  const { settings: s, now } = input;
  const range = { startsAt: slot.startsAt, endsAt: slot.endsAt };
  if (!inSeason(slot.date, s)) return false; // (a) season
  if (slot.startsAt <= now) return false; // (a) never offer a past window
  if (windowBlock(slot, input.blocks)) return false; // (b) blocked (the day or this window, T2.5.06) / away
  if (
    !s.householdHoldReleased &&
    slot.date === HOUSEHOLD_HOLD.date &&
    slot.windowKind === HOUSEHOLD_HOLD.windowKind
  )
    return false; // (c)
  if (rangedBookings(input.bookings).some((b) => overlaps(b, range))) return false; // (d)
  if (bigDays.has(slot.date)) return false; // (e)
  if (heldByOffer(slot.id, range, input.offers, now, input.viewerRequestId)) return false; // (f)
  if (busyClash(range, input.busy)) return false; // (g)
  if (isWeekFull(weekStartOf(slot.date), input.bookings, input.weeks, s)) return false; // (h)
  return input.dishWindows.includes(slot.windowKind); // (i)
}

/** Rule 10: exactly one state per invite × dish × week. */
export function weekStatus(
  weekStart: string,
  input: EngineInput,
  bigDays = bigDayDates(input.bookings),
): WeekOut {
  const weekSlots = input.slots
    .filter((sl) => weekStartOf(sl.date) === weekStart)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  let state: WeekState;
  let windows: WeekOut['windows'] = [];
  if (input.now < opensAtFor(input)) {
    state = 'closed';
  } else if (weekSlots.length > 0 && weekSlots.every((sl) => blockCovering(sl.date, input.blocks, 'away'))) {
    state = 'away';
  } else {
    windows = weekSlots
      .filter((sl) => isSlotOpen(sl, input, bigDays))
      .map((sl) => ({
        slotId: sl.id,
        date: sl.date,
        window: sl.windowKind,
        label: windowLabel(sl.startsAt),
      }));
    state = windows.length > 0 ? 'open' : 'spoken_for';
  }
  return { weekStart, state, windows };
}

/** Rule 11: dates-mode grid greys out blocks, away, pre-release and past dates. Never bookings. */
export function unavailableDates(input: EngineInput): string[] {
  const { settings: s } = input;
  const today = vancouverDate(input.now);
  const closed = input.now < opensAtFor(input);
  const out: string[] = [];
  for (let d = s.seasonStart; d <= s.seasonEnd; d = addDays(d, 1)) {
    if (closed || d < today || blockCovering(d, input.blocks)) out.push(d);
  }
  return out;
}

/**
 * The picker payload. Omitted from `weeks`: weeks with no Thu/Fri slot (e.g. Jun 28), and past weeks, meaning
 * every slot has already started. A past week isn't "spoken for" (rule 10 means full), so it must never offer
 * stand-by (review T4.2.00 H3).
 */
export function openWindows(input: EngineInput): EngineOutput {
  const bigDays = bigDayDates(input.bookings);
  const weekStarts = [
    ...new Set(input.slots.filter((sl) => sl.startsAt > input.now).map((sl) => weekStartOf(sl.date))),
  ].sort();
  const out: EngineOutput = {
    weeks: weekStarts.map((w) => weekStatus(w, input, bigDays)),
    unavailableDates: unavailableDates(input),
  };
  const opensAt = opensAtFor(input);
  if (input.now < opensAt) out.opensAt = opensAt.toISOString();
  const today = vancouverDate(input.now);
  const away = input.blocks
    .filter((b) => b.kind === 'away' && b.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (away) out.awayNotice = { until: away.endDate, confirmBy: away.confirmBy };
  return out;
}
