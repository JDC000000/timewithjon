// src/features/admin/lock-check.ts — QA4 H1: Lock in's pre-check, read only. The same C3 rule 8 verdict the lock
// itself reaches (features/requests/lock.ts applyLock → canLock), asked BEFORE A3 starts the "Locked in… invite goes
// out in 10 s" window, so a refusal (a full week, a blocked date) shows at once and the dates sheet can offer its
// tick. Nothing is written and no row is locked: the lock still re-checks inside its transaction (a race between
// the two is the only refusal left after the toast, and A3 keeps that one visible). Server-only.
import 'server-only';
import { dishBySlug } from '@/content/menu-helpers';
import {
  canLock,
  REFUSAL_MESSAGE,
  type LockRefusal,
  type LockWarning,
} from '@/features/availability/canLock';
import { loadEngineData } from '@/features/availability/load';
import { dishWeekCount, slotCountsToward, weekCapCount } from '@/features/availability/rules';
import type { CountsToward, RequestStatus, Slot } from '@/features/availability/types';
import type { LockTarget } from '@/features/requests/lock';
import { q } from '@/lib/db';
import { vancouverDate, weekStartOf } from '@/lib/time';

export type LockCheck =
  | { ok: true; warnings: LockWarning[] }
  | {
      ok: false;
      reason: LockRefusal | 'request_not_found' | 'slot_not_found';
      message: string;
      /** week_full: which booking of the week this would be ("Override this week: it would be the 3rd"). */
      nth: number | null;
    };

export async function checkLock(
  requestId: string,
  target: LockTarget,
  ticks: { overrideWeek: boolean; bookAnyway: boolean },
  now = new Date(),
): Promise<LockCheck> {
  const [r] = await q<{
    status: RequestStatus;
    counts_toward: CountsToward;
    dish: string;
    joined_to_request_id: string | null;
  }>(`select status, counts_toward, dish, joined_to_request_id from request where id = $1`, [requestId]);
  if (!r) return { ok: false, reason: 'request_not_found', message: '', nth: null };
  if (r.joined_to_request_id && r.status === 'locked')
    return { ok: false, reason: 'not_lockable', message: REFUSAL_MESSAGE.not_lockable, nth: null };

  let slot: Slot | null = null;
  if ('slotId' in target) {
    const [s] = await q<{
      id: string;
      date: string;
      window_kind: Slot['windowKind'];
      starts_at: Date;
      ends_at: Date;
    }>(`select id, date::text, window_kind, starts_at, ends_at from slot where id = $1`, [target.slotId]);
    if (!s) return { ok: false, reason: 'slot_not_found', message: '', nth: null };
    slot = { id: s.id, date: s.date, windowKind: s.window_kind, startsAt: s.starts_at, endsAt: s.ends_at };
  }
  const range = slot
    ? { startsAt: slot.startsAt, endsAt: slot.endsAt }
    : (target as { startsAt: Date; endsAt: Date });
  // As applyLock: a slot's kind comes from the dish; a range takes the kind Jon set, else the row's.
  const countsToward = slot
    ? slotCountsToward(dishBySlug(r.dish))
    : ('countsToward' in target && target.countsToward) || r.counts_toward;

  const loaded = await loadEngineData(now);
  const verdict = canLock({
    now,
    request: { id: requestId, status: r.status, countsToward, dish: r.dish },
    mode: 'lock',
    target: slot ? { slot } : { range },
    bookings: loaded.bookings,
    blocks: loaded.blocks,
    weeks: loaded.weeks,
    offers: loaded.offers,
    settings: loaded.settings,
    overrideWeek: ticks.overrideWeek,
    bookAnyway: ticks.bookAnyway,
  });
  if (verdict.ok) return verdict;
  const week = weekStartOf(vancouverDate(range.startsAt));
  const nth =
    verdict.reason === 'week_full'
      ? (countsToward === 'weekly_cap'
          ? weekCapCount(week, loaded.bookings, requestId)
          : dishWeekCount(week, r.dish, loaded.bookings, requestId)) + 1
      : null;
  return { ok: false, reason: verdict.reason, message: REFUSAL_MESSAGE[verdict.reason], nth };
}
