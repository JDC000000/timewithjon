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
