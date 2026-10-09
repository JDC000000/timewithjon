// src/lib/engine/canLock.ts — C3 rule 8. Called inside the T2.3 transaction (week row lock held).
import { dishBySlug } from '@/content/menu-helpers';
import { datesTouched, vancouverDate, weekStartOf } from '@/lib/time';
import {
  bigDayDates,
  blockedBy,
  dishWeekCount,
  heldByOffer,
  inSeason,
  isWeekFull,
  overlaps,
  rangedBookings,
  windowFitsDish,
} from './rules';
import type {
  Block,
  Booking,
  CountsToward,
  EngineSettings,
  Offer,
  Range,
  RequestStatus,
  Slot,
  Week,
} from './types';

export type LockRefusal =
  | 'cancelled'
  | 'already_locked'
  | 'not_lockable'
  | 'out_of_season'
  | 'time_taken'
  | 'big_day_clash'
  | 'week_full'
  | 'blocked'
  | 'in_the_past'
  | 'not_for_this_dish';
export type LockWarning = 'standby_offer_live';

export interface CanLockInput {
  now: Date;
  /** dish = the request's dish slug: a dish with maxPerWeek (Something New) is limited per week. */
  request: { id: string; status: RequestStatus; countsToward: CountsToward; dish: string };
  mode: 'lock';
  target: { slot: Slot } | { range: Range };
  bookings: Booking[];
  blocks: Block[];
  weeks: Week[];
  offers: Offer[];
  settings: EngineSettings;
  overrideWeek?: boolean; // "Override this week"
  bookAnyway?: boolean; // "Book anyway" (blocked date or Big Day clash)
  /**
   * CR-05: apply rule 2(i), a slot only for a dish that uses its window. On for what a GUEST gets: a stand-by offer
   * (unless Jon ticked L13's Override) and the take of a suggested time. Jon's own Lock it in and Promote to host
   * leave it off: A3 lists only the dish's windows, and past that the call is his, like Book anyway.
   */
  windowRule?: boolean;
}

export type CanLockResult = { ok: true; warnings: LockWarning[] } | { ok: false; reason: LockRefusal };

const LOCKABLE: RequestStatus[] = ['requested', 'needs_new_time', 'standby'];

export function canLock(i: CanLockInput): CanLockResult {
  const st = i.request.status;
  if (i.mode === 'lock' && !LOCKABLE.includes(st)) {
    return {
      ok: false,
      reason:
        st === 'cancelled'
          ? 'cancelled'
          : st === 'locked' || st === 'done'
            ? 'already_locked'
            : 'not_lockable',
    };
  }

  const range: Range =
    'slot' in i.target ? { startsAt: i.target.slot.startsAt, endsAt: i.target.slot.endsAt } : i.target.range;
  const slotId = 'slot' in i.target ? i.target.slot.id : null;
  // CR-05, rule 2(i): no lunch for The First Round, no slot for a dates-only dish (see windowRule).
  if (
    i.windowRule &&
    'slot' in i.target &&
    !windowFitsDish(dishBySlug(i.request.dish), i.target.slot.windowKind)
  )
    return { ok: false, reason: 'not_for_this_dish' };
  const dates = datesTouched(range.startsAt, range.endsAt);
  const self = i.request.id; // a request never counts against itself

  // L7: a time that has started can't be locked; the season is judged on the START date, so an
  // Encore on Wed Jun 30 that runs past midnight is still in season.
  if (range.startsAt <= i.now) return { ok: false, reason: 'in_the_past' };
  if (!inSeason(vancouverDate(range.startsAt), i.settings)) return { ok: false, reason: 'out_of_season' };
  const others = rangedBookings(i.bookings, self);
  if (others.some((b) => overlaps(b, range))) return { ok: false, reason: 'time_taken' };

  if (!i.bookAnyway) {
    // The one block rule (rules.ts blockedBy): a whole-day block on any date touched, a single-window block
    // (T2.5.06) on this window or its times, or the household hold (QA r2 L6), a date dish's range included.
    if (blockedBy(i.target, i.blocks, i.settings)) return { ok: false, reason: 'blocked' };
    // Rule 2(e), both directions (rule 8). ENG-11 (operator pick): on ANY day, not only Thu/Fri. A Big Day is the
    // whole day, so a second Big Day that Saturday, or an Encore on its evening, needs Book anyway too.
    // A booking that counts toward nothing (a phone call) is not an outing: it neither blocks a Big Day nor is
    // blocked by one (operator pick, 2026-10-09). Overlapping times are still refused (time_taken, above).
    if (i.request.countsToward === 'big_day') {
      const busy = new Set(
        others.filter((b) => b.countsToward !== 'none').flatMap((b) => datesTouched(b.startsAt, b.endsAt)),
      );
      if (dates.some((d) => busy.has(d))) return { ok: false, reason: 'big_day_clash' };
    } else if (i.request.countsToward !== 'none') {
      const bigDays = bigDayDates(i.bookings, self);
      if (dates.some((d) => bigDays.has(d))) return { ok: false, reason: 'big_day_clash' };
    }
  }

  if (!i.overrideWeek) {
    const week = weekStartOf(vancouverDate(range.startsAt));
    if (i.request.countsToward === 'weekly_cap' && isWeekFull(week, i.bookings, i.weeks, i.settings, self))
      return { ok: false, reason: 'week_full' };
    // Decision 43(4): a per-week dish limit (Something New: 1 a week). It reads as a full week, so Jon's
    // "Override this week" also lifts it.
    const maxPerWeek = dishBySlug(i.request.dish)?.maxPerWeek;
    if (maxPerWeek !== undefined && dishWeekCount(week, i.request.dish, i.bookings, self) >= maxPerWeek)
      return { ok: false, reason: 'week_full' };
  }

  const warnings: LockWarning[] = heldByOffer(slotId, range, i.offers, i.now, self)
    ? ['standby_offer_live']
    : [];
  return { ok: true, warnings };
}

/** HTTP mapping used by the admin routes (§6 "Lock race outcomes"). */
export const REFUSAL_MESSAGE: Record<LockRefusal, string> = {
  cancelled: 'They cancelled.',
  already_locked: 'Already locked in.',
  not_lockable: 'That request can’t be locked right now.',
  out_of_season: 'That’s outside April to June.',
  time_taken: 'That time just went.',
  big_day_clash: 'That day already has a booking. Tick Book anyway to go ahead.',
  week_full: 'That week is full. Tick Override this week to go ahead.',
  in_the_past: 'That time has already passed.',
  blocked: 'That date is blocked. Tick Book anyway to go ahead.',
  not_for_this_dish: 'That time doesn’t fit this dish.', // NEW COPY (needs Jon)
};
