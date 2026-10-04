// src/lib/requests/validate.ts — T1.7 server re-check of a request against the dish and the engine. Pure.
import { isBookable } from '@/content/menu-helpers';
import type { Dish } from '@/content/types';
import { dateRuleAllows } from '@/features/availability/rules';
import type { CountsToward, EngineOutput } from '@/features/availability/types';
import { addDays, vancouverDate } from '@/lib/time';
import type { RequestBody } from './schema';

export type ValidationCode =
  | 'not_bookable'
  | 'no_times'
  | 'time_gone'
  | 'standby_not_allowed'
  | 'need_to_know_required'
  | 'idea_required'
  | 'no_dates'
  | 'out_of_season'
  | 'date_unavailable'
  | 'date_not_allowed'
  | 'overnight_not_allowed'
  | 'night_without_overnight'
  | 'bad_time_zone';
export type Validated =
  | {
      ok: true;
      mode: 'slots' | 'dates';
      countsToward: CountsToward;
      status: 'requested' | 'standby';
      bigCrew: boolean;
    }
  | { ok: false; code: ValidationCode };

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The body as stored: a sealed Surprise plan only on a Surprise Me request (any other dish drops it). */
export function storableBody(b: RequestBody, dish: Dish): RequestBody {
  return dish.flow === 'surprise' || b.surprisePlan === undefined ? b : { ...b, surprisePlan: undefined };
}

export function validateRequest(
  b: RequestBody,
  dish: Dish,
  engine: EngineOutput,
  season: { start: string; end: string },
  now = new Date(),
): Validated {
  if (!isBookable(dish, now)) return { ok: false, code: 'not_bookable' };
  if (b.overnight && !dish.overnightAllowed) return { ok: false, code: 'overnight_not_allowed' };
  if (b.overnightNight && !b.overnight) return { ok: false, code: 'night_without_overnight' };
  if (b.guestTimeZone && !validTz(b.guestTimeZone)) return { ok: false, code: 'bad_time_zone' };
  if (dish.flow === 'surprise' && !b.surpriseNeedToKnow?.trim())
    return { ok: false, code: 'need_to_know_required' };
  if (dish.flow === 'pitch' && !b.pitchIdea?.trim()) return { ok: false, code: 'idea_required' };
  const bigCrew = b.crew >= 16;
  const useSlots =
    dish.mode === 'slots' || (dish.mode === 'slots-or-dates' && b.dates.length === 0 && !b.windowText);

  if (useSlots) {
    const open = new Set(engine.weeks.flatMap((w) => w.windows.map((x) => x.slotId)));
    if (b.standbyWeek) {
      // The engine omits past weeks; the Friday check is a backstop in case a caller passes a stale payload (H3).
      const weekOver = addDays(b.standbyWeek, 4) < vancouverDate(now);
      const wk = engine.weeks.find((w) => w.weekStart === b.standbyWeek);
      if (weekOver || !wk || wk.state !== 'spoken_for' || b.slotIds.length > 0)
        return { ok: false, code: 'standby_not_allowed' };
      return { ok: true, mode: 'slots', countsToward: 'weekly_cap', status: 'standby', bigCrew };
    }
    if (b.slotIds.length === 0) return { ok: false, code: 'no_times' };
    if (!b.slotIds.every((id) => open.has(id))) return { ok: false, code: 'time_gone' }; // full, blocked, pre-release, wrong window
    return {
      ok: true,
      mode: 'slots',
      countsToward: dish.countsToward === 'jon_sets' ? 'none' : dish.countsToward,
      status: 'requested',
      bigCrew,
    };
  }

  if (b.dates.length === 0 && !b.windowText?.trim()) return { ok: false, code: 'no_dates' };
  const unavailable = new Set(engine.unavailableDates);
  for (const d of b.dates) {
    if (d < season.start || d > season.end) return { ok: false, code: 'out_of_season' };
    if (unavailable.has(d)) return { ok: false, code: 'date_unavailable' };
    if (!dateRuleAllows(dish.dateRule, d)) return { ok: false, code: 'date_not_allowed' };
  }
  const countsToward: CountsToward =
    dish.countsToward === 'jon_sets'
      ? b.overnight
        ? 'big_day'
        : 'none' // provisional; Jon sets it at lock (C3 rule 5)
      : dish.mode === 'slots-or-dates'
        ? (dish.datesCountToward ?? 'big_day')
        : dish.countsToward;
  return { ok: true, mode: 'dates', countsToward, status: 'requested', bigCrew };
}
