// src/lib/engine/openWindows.ts — C3 rules 1–2, 10, 11. Pure.
import type { DateRule } from '@/content/types';
import { addDays, datesTouched, vancouverDate, weekStartOf, windowLabel } from '@/lib/time';
import {
  bigDayDates,
  blockCovering,
  busyClash,
  dateRuleAllows,
  dishWeekCount,
  heldByOffer,
  HOUSEHOLD_HOLD,
  inSeason,
  isWeekFull,
  overlaps,
  rangedBookings,
  windowBlock,
} from './rules';
import type { CountsToward, EngineInput, EngineOutput, Slot, WeekOut, WeekState } from './types';

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

/**
 * Rule 11: dates-mode grid greys out blocks, away, pre-release and past dates, and the household hold's date while
 * it stands (rule 2(c), QA r2 L6). Never bookings.
 */
export function unavailableDates(input: EngineInput): string[] {
  const { settings: s } = input;
  const today = vancouverDate(input.now);
  const closed = input.now < opensAtFor(input);
  const held = s.householdHoldReleased ? null : HOUSEHOLD_HOLD.date;
  const out: string[] = [];
  for (let d = s.seasonStart; d <= s.seasonEnd; d = addDays(d, 1)) {
    if (closed || d < today || d === held || blockCovering(d, input.blocks)) out.push(d);
  }
  return out;
}

/** What a dates-mode dish needs from the content module for its week state. */
export interface DateDish {
  countsToward: CountsToward;
  dateRule?: DateRule | null;
  /** ENG-06: a per-week dish limit (Something New: 1 a week, decision 43(4)), as canLock applies it. */
  slug?: string;
  maxPerWeek?: number;
}

/**
 * Rule 10 for a dates-mode dish (QA r2 M3: the stand-by sheet): its week state comes from the week's dates, not
 * from Thu/Fri time slots it never uses. 'closed' before release and 'away' as weekStatus; otherwise 'open' while
 * one date the dish allows is still free to pick (rule 11) and could still be locked: not a locked Big Day's date
 * (2(e)), for a Big Day not a Thu/Fri another booking uses (rule 8), for a weekly-cap dish not a full week (2(h)).
 */
export function dateWeekStatus(
  weekStart: string,
  input: EngineInput,
  dish: DateDish,
  bigDays = bigDayDates(input.bookings),
): WeekState {
  if (input.now < opensAtFor(input)) return 'closed';
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter((d) =>
    inSeason(d, input.settings),
  );
  if (dates.length > 0 && dates.every((d) => blockCovering(d, input.blocks, 'away'))) return 'away';
  const off = new Set(unavailableDates(input));
  const booked = new Set(
    rangedBookings(input.bookings, input.viewerRequestId).flatMap((b) => datesTouched(b.startsAt, b.endsAt)),
  );
  const full =
    (dish.countsToward === 'weekly_cap' &&
      isWeekFull(weekStart, input.bookings, input.weeks, input.settings)) ||
    (dish.maxPerWeek !== undefined &&
      dish.slug !== undefined &&
      dishWeekCount(weekStart, dish.slug, input.bookings, input.viewerRequestId) >= dish.maxPerWeek);
  const free = dates.filter(
    (d) =>
      !off.has(d) &&
      dateRuleAllows(dish.dateRule, d) &&
      !bigDays.has(d) &&
      !(dish.countsToward === 'big_day' && booked.has(d)) && // ENG-11: any day, as canLock
      !full,
  );
  return free.length > 0 ? 'open' : 'spoken_for';
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

/**
 * QA4 L2: Ask for another time never lists the time already booked (sending it would un-book it and re-ask Jon for
 * the same window). The rest of that week stays: the guest's own booking doesn't cap it (withoutOwnBooking).
 */
export function withoutSlot(out: EngineOutput, slotId: string | null): EngineOutput {
  if (!slotId) return out;
  return {
    ...out,
    weeks: out.weeks.map((w) => {
      if (!w.windows.some((x) => x.slotId === slotId)) return w;
      const windows = w.windows.filter((x) => x.slotId !== slotId);
      return { ...w, windows, state: windows.length > 0 ? w.state : 'spoken_for' };
    }),
  };
}
