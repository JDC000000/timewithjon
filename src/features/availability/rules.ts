// src/lib/engine/rules.ts — the shared C3 predicates. Pure functions only.
import type { DateRule, Dish } from '@/content/types';
import { datesTouched, isoWeekday, vancouverDate, vancouverInstant, weekStartOf } from '@/lib/time';
import type {
  Block,
  Booking,
  BusyInterval,
  CountsToward,
  EngineSettings,
  Offer,
  Range,
  Slot,
  Week,
  WindowKind,
} from './types';

/** Half-open overlap: [aS,aE) ∩ [bS,bE) ≠ ∅ */
export function overlaps(a: Range, b: Range): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** Joined requests have no range and never count (rule 9, T2.10). */
export function rangedBookings(bookings: Booking[], excludeRequestId?: string): Booking[] {
  return bookings.filter((b) => b.joinedToRequestId === null && b.requestId !== excludeRequestId);
}

/** Rule 2(c): Jon's household hold, Thu Apr 1 lunch, until Jon releases it. Fixed, not tied to season_start (L5). */
export const HOUSEHOLD_HOLD = { date: '2027-04-01', windowKind: 'lunch' } as const;
/** The hold's times (the lunch window's, 12–2), so a range lock can't cover it either (QA r2 L6). */
export const HOUSEHOLD_HOLD_RANGE: Range = {
  startsAt: vancouverInstant(HOUSEHOLD_HOLD.date, '12:00'),
  endsAt: vancouverInstant(HOUSEHOLD_HOLD.date, '14:00'),
};

/** The household hold still stands over this range (QA r2 L6: date dishes respect it as time dishes do). */
export function householdHoldOver(range: Range, s: Pick<EngineSettings, 'householdHoldReleased'>): boolean {
  return !s.householdHoldReleased && overlaps(range, HOUSEHOLD_HOLD_RANGE);
}

/**
 * Rules 2(b), 2(c) and 8, the ONE block rule (locks, Suggest another time and the block-confirm move all use it):
 * what keeps a window shut, or null. A whole-day block on any date the window touches (so one running past
 * midnight into a blocked day counts); a single-window block (T2.5.06) on its own slot, or one whose times it
 * overlaps (a range can't cover it); or the household hold while it stands (QA r2 L6).
 */
export function blockedBy<B extends Block>(
  target: { slot: Pick<Slot, 'date' | 'windowKind' | 'startsAt' | 'endsAt'> } | { range: Range },
  blocks: B[],
  s: Pick<EngineSettings, 'householdHoldReleased'>,
): B | 'household_hold' | null {
  const range =
    'slot' in target ? { startsAt: target.slot.startsAt, endsAt: target.slot.endsAt } : target.range;
  for (const d of datesTouched(range.startsAt, range.endsAt)) {
    const whole = blockCovering(d, blocks);
    if (whole) return whole;
  }
  const window =
    ('slot' in target && windowBlock(target.slot, blocks)) || windowBlockOverlapping(range, blocks);
  if (window) return window as B;
  return householdHoldOver(range, s) ? 'household_hold' : null;
}

/** A dates-mode dish's day rule (the grid, validate.ts and the engine share it): weekends, or Thu to Sun. */
export function dateRuleAllows(rule: DateRule | null | undefined, date: string): boolean {
  const dow = isoWeekday(date);
  if (rule === 'weekend') return dow >= 6;
  if (rule === 'weekend-or-thu-fri') return dow >= 4;
  return true;
}

/**
 * CR-01: what a lock on a slot counts toward. A slot is one lunch or evening window, never a whole day, so it is
 * never a Big Day: it counts toward the week like every slots dish (a dish that counts toward nothing, e.g. a call,
 * still counts toward nothing). Derived from the dish, never from the row: a row can carry a Big Day copied from an
 * old host (joined-cascade.ts), or a dates dish's kind on a stand-by or suggested window.
 */
export function slotCountsToward(dish: Pick<Dish, 'countsToward'> | undefined): CountsToward {
  return dish?.countsToward === 'none' ? 'none' : 'weekly_cap';
}

/** Rule 2(i) and L13: a window the dish can use (a lunch is never a First Round's; a dates-only dish has none). */
export function windowFitsDish(dish: Pick<Dish, 'windows'> | undefined, windowKind: WindowKind): boolean {
  return Boolean(dish?.windows.includes(windowKind));
}

export function inSeason(date: string, s: EngineSettings): boolean {
  return date >= s.seasonStart && date <= s.seasonEnd;
}

/** A WHOLE-DAY block or away range over this date (a single-window block, T2.5.06, closes only its window). */
export function blockCovering<B extends Block>(
  date: string,
  blocks: B[],
  kind?: Block['kind'],
): B | undefined {
  return blocks.find(
    (b) => b.window == null && (!kind || b.kind === kind) && date >= b.startDate && date <= b.endDate,
  );
}

/**
 * Rule 2(b) for one window (T2.5.06): the block that closes it. A whole-day block over its date wins; otherwise a
 * block on just this window of this date.
 */
export function windowBlock<B extends Block>(
  slot: Pick<Slot, 'date' | 'windowKind'>,
  blocks: B[],
): B | undefined {
  return (
    blockCovering(slot.date, blocks) ??
    blocks.find((b) => b.window === slot.windowKind && slot.date >= b.startDate && slot.date <= b.endDate)
  );
}

/** T2.5.06: a single-window block whose times overlap this range (a range lock, e.g. a Big Day, can't cover it). */
export function windowBlockOverlapping(range: Range, blocks: Block[]): Block | undefined {
  return blocks.find((b) => b.window != null && b.windowRange != null && overlaps(b.windowRange, range));
}

export function capFor(weekStart: string, weeks: Week[], s: EngineSettings): number {
  return weeks.find((w) => w.weekStart === weekStart)?.capOverride ?? s.defaultWeeklyCap;
}

/** Rule 3: locked + done weekly_cap bookings in the week (Vancouver local week). */
export function weekCapCount(weekStart: string, bookings: Booking[], excludeRequestId?: string): number {
  return rangedBookings(bookings, excludeRequestId).filter(
    (b) => b.countsToward === 'weekly_cap' && weekStartOf(vancouverDate(b.startsAt)) === weekStart,
  ).length;
}

export function isWeekFull(
  weekStart: string,
  bookings: Booking[],
  weeks: Week[],
  s: EngineSettings,
  excludeRequestId?: string,
): boolean {
  return weekCapCount(weekStart, bookings, excludeRequestId) >= capFor(weekStart, weeks, s);
}

/** Decision 43(4): how many locked/done bookings of this dish start in the week (Something New: at most 1). */
export function dishWeekCount(
  weekStart: string,
  dish: string,
  bookings: Booking[],
  excludeRequestId?: string,
): number {
  return rangedBookings(bookings, excludeRequestId).filter(
    (b) => b.dish === dish && weekStartOf(vancouverDate(b.startsAt)) === weekStart,
  ).length;
}

/** Rule 2(e): every Vancouver date touched by a locked Big Day. */
export function bigDayDates(bookings: Booking[], excludeRequestId?: string): Set<string> {
  const out = new Set<string>();
  for (const b of rangedBookings(bookings, excludeRequestId)) {
    if (b.countsToward === 'big_day') datesTouched(b.startsAt, b.endsAt).forEach((d) => out.add(d));
  }
  return out;
}

export function isThuFri(date: string): boolean {
  const d = isoWeekday(date);
  return d === 4 || d === 5;
}

export function isOfferLive(o: Offer, now: Date): boolean {
  return (
    o.kind === 'standby_open' &&
    o.takenAt === null &&
    o.releasedAt === null &&
    (o.expiresAt === null || o.expiresAt > now)
  );
}

/** Rule 2(f): the live standby_open offers of OTHER requests that hold this slot or range. */
export function offersHolding(
  slotId: string | null,
  range: Range,
  offers: Offer[],
  now: Date,
  viewerRequestId?: string,
): Offer[] {
  return offers.filter(
    (o) =>
      isOfferLive(o, now) &&
      o.requestId !== viewerRequestId &&
      ((slotId !== null && o.slotIds.includes(slotId)) || o.ranges.some((r) => overlaps(r, range))),
  );
}

/** Rule 2(f): a live standby_open offer for ANOTHER request holds a slot or range. */
export function heldByOffer(
  slotId: string | null,
  range: Range,
  offers: Offer[],
  now: Date,
  viewerRequestId?: string,
): boolean {
  return offersHolding(slotId, range, offers, now, viewerRequestId).length > 0;
}

export function busyClash(range: Range, busy: BusyInterval[] | null): boolean {
  if (busy === null) return false; // fail open (rule 7)
  return busy.some((b) => range.startsAt < b.end && b.start < range.endsAt);
}
