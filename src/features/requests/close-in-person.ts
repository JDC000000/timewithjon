// src/features/requests/close-in-person.ts — T2.10.02 Jon's "Close (handled in person)" (§6 state machine:
// `requested` / `needs_new_time` / `standby` → `cancelled` with closed_in_person). It sends NO email (T2.10 AC3);
// the guest's manage page then reads "Sorted. See you soon." (CLOSED_IN_PERSON_LABEL). Live offers are released so
// their windows free up at once. Nothing to do on the calendar: none of these states has an event of its own.
import 'server-only';
import type { PoolClient } from 'pg';
import { withTx } from '@/lib/db';
import { releaseLiveOffers } from './offers';

export type CloseResult =
  | { ok: true; already: boolean }
  | { ok: false; status: 404; reason: 'request_not_found' }
  | { ok: false; status: 409; reason: 'not_closable'; message: string };

export const NOT_CLOSABLE_MESSAGE = 'That one is locked in. Use Cancel for the guest instead.';
const CLOSABLE = new Set(['requested', 'needs_new_time', 'standby']);

async function closeTx(c: PoolClient, requestId: string, now: Date): Promise<CloseResult> {
  const { rows } = await c.query<{ status: string }>(
    `select r.status from request r where r.id = $1 for update`,
    [requestId],
  );
  const r = rows[0];
  if (!r) return { ok: false, status: 404, reason: 'request_not_found' };
  // Already cancelled (quietly or not): nothing to change, and still no email.
  if (r.status === 'cancelled') return { ok: true, already: true };
  if (!CLOSABLE.has(r.status))
    return { ok: false, status: 409, reason: 'not_closable', message: NOT_CLOSABLE_MESSAGE };

  await c.query(
    `update request
        set status = 'cancelled', closed_in_person = true, cancelled_at = $2, cancelled_by = 'jon',
            awaiting_jon_since = null
      where id = $1`,
    [requestId, now],
  );
  await releaseLiveOffers(c, requestId);
  await c.query(
    `insert into audit_log (actor, action, request_id, detail) values ('jon', 'request_closed_in_person', $1, $2)`,
    [requestId, JSON.stringify({ from_status: r.status, to_status: 'cancelled' })],
  );
  return { ok: true, already: false };
}

export function closeInPerson(requestId: string, now = new Date()): Promise<CloseResult> {
  return withTx((c) => closeTx(c, requestId, now));
}
