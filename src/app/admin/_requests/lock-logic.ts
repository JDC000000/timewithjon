// src/app/admin/_requests/lock-logic.ts — T2.3.U1: the Lock in POST (T2.3.04; Change time removed 2026-09-29) and how each answer
// reads on A3. A 409 carries the server's own words (REFUSAL_MESSAGE, e.g. "That time just went…", wireframe 09
// A3p); a 404 means the request (or the time) is gone. No React here.
import { ERRORS } from '@/content';
import { send, type Send } from './api';

export interface LockTicks {
  /** "Override this week: it would be the 3rd" (wireframe 09 A3o2). */
  overrideWeek: boolean;
  /** "Book anyway: that date's blocked" (wireframe 09 A3o). */
  bookAnyway: boolean;
}

export type LockOutcome =
  { ok: true; standbyOfferLive: boolean } | { ok: false; code: string | null; message: string };

export async function sendLock(
  requestId: string,
  target:
    | { slotId: string }
    | { date: string; start: string; lengthMinutes: number; countsToward?: string; where?: string | null },
  ticks: LockTicks = { overrideWeek: false, bookAnyway: false },
  post: Send = send,
): Promise<LockOutcome> {
  const res = await post<{ warnings?: string[] }>('POST', `/api/admin/requests/${requestId}/lock`, {
    ...target,
    ...ticks,
  });
  if (res.status === 200) {
    return { ok: true, standbyOfferLive: (res.data?.warnings ?? []).includes('standby_offer_live') };
  }
  if (res.status === 409 && res.message) return { ok: false, code: res.code ?? null, message: res.message };
  return { ok: false, code: res.code ?? null, message: ERRORS.generic };
}

export type LockCheckOutcome =
  | { ok: true }
  | {
      ok: false;
      code: string | null;
      message: string;
      /** week_full: "it would be the 3rd" */ nth: number | null;
    };

/**
 * QA4 H1: ask the server whether this lock would go through BEFORE the undo window starts (read only:
 * POST /api/admin/requests/[id]/lock-check), so a full week or a blocked date is refused at once, never after
 * "Locked in… invite goes out in 10 s". No answer (offline, a 5xx) is a refusal too: the window never opens on a guess.
 */
export async function checkLock(
  requestId: string,
  target: Parameters<typeof sendLock>[1],
  ticks: LockTicks,
  post: Send = send,
): Promise<LockCheckOutcome> {
  const res = await post<{
    check?: { ok: boolean; reason?: string; message?: string; nth?: number | null };
  }>('POST', `/api/admin/requests/${requestId}/lock-check`, { ...target, ...ticks });
  const c = res.status === 200 ? res.data?.check : undefined;
  if (c?.ok) return { ok: true };
  if (c)
    return { ok: false, code: c.reason ?? null, message: c.message || ERRORS.generic, nth: c.nth ?? null };
  return { ok: false, code: res.code ?? null, message: ERRORS.generic, nth: null };
}

/** Which tick a refusal asks for (REFUSAL_MESSAGE: "Tick Override this week…", "Tick Book anyway…"), if any. */
export function tickFor(code: string | null): keyof LockTicks | null {
  if (code === 'week_full') return 'overrideWeek';
  if (code === 'blocked' || code === 'big_day_clash') return 'bookAnyway';
  return null;
}
