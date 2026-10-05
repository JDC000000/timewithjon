// src/features/requests/guest-cancel.ts — T2.7.04 the guest cancels on the manage page (§6 state machine, the
// "Joined requests" rules 2 and 4). One transaction: the request row (FOR UPDATE), the status, the audit row, live
// offers released, the calendar outbox row and the pending E11 + E12 rows. Google and the mailer run after
// commit (L-3). A cancelled booking no longer counts anywhere, so its window is free at once (T2.7 AC5).
// T2.9.03: Jon's "Cancel for the guest" (A3) is the same transaction with by='jon': cancelled_by/actor 'jon',
// and E17 only (QA r2 M5: his own words, never the self-cancel E11), never E12 (§6; C5: E12 is only for a guest's
// own cancel).
import 'server-only';
import type { PoolClient } from 'pg';
import { E12_PARTS } from '@/content/emails';
import { dishInSentence } from '@/content/menu-helpers';
import { queueIcsEmail } from '@/features/calendar/ics-email';
import { jonEmail, queueEmail } from '@/features/email/send';
import { withTx } from '@/lib/db';
import { vancouverDate, weekStartOf } from '@/lib/time';
import { whenLabel } from '@/lib/when';
import { hostLeft } from './joined-cascade';
import { releaseLiveOffers } from './offers';
import {
  adminLink,
  enqueueCalendar,
  lockHostOf,
  noSideEffects,
  patchHostIfLocked,
  queuedId,
  runAfterCommit,
  type AfterCommit,
} from './side-effects';

export type CancelResult =
  | { ok: true; already: boolean }
  | { ok: false; status: 404; reason: 'request_not_found' }
  | { ok: false; status: 409; reason: 'already_done' };

interface Row {
  status: string;
  dish: string;
  contact_name: string;
  contact_email: string;
  joined_to_request_id: string | null;
  starts_at: Date | null; // the host's for a joined request (rule 1)
  ends_at: Date | null;
  host_status: string | null;
  google_event_id: string | null;
  calendar_state: string;
}

/**
 * E12's {when} (T3.2, M7): the locked time as the site writes it, "Fri Apr 2 · noon–2 pm" (Vancouver, whenLabel);
 * null when nothing was locked.
 */
export function e12When(r: Pick<Row, 'status' | 'starts_at' | 'ends_at'>): string | null {
  if (r.status !== 'locked' || !r.starts_at || !r.ends_at) return null;
  return whenLabel(r.starts_at, r.ends_at);
}

/** Jon cancelled it for the guest (not closed in person): the guest may ask for another time (2026-10-05). */
export function isJonCancelled(r: {
  status: string;
  cancelled_by: 'guest' | 'jon' | null;
  closed_in_person: boolean;
}): boolean {
  return r.status === 'cancelled' && r.cancelled_by === 'jon' && !r.closed_in_person;
}

/** Locked (own or through the host) and the end has passed: lazily done (AD-8), so nothing left to cancel. */
export function isLazilyDone(r: Pick<Row, 'status' | 'ends_at'>, now: Date): boolean {
  return r.status === 'done' || (r.status === 'locked' && r.ends_at !== null && r.ends_at <= now);
}

type CancelledBy = 'guest' | 'jon';

async function cancelTx(
  c: PoolClient,
  requestId: string,
  now: Date,
  by: CancelledBy,
): Promise<{ result: CancelResult; after: AfterCommit }> {
  await lockHostOf(c, requestId); // host first, then this row (pr48-review F3)
  const {
    rows: [r],
  } = await c.query<Row>(
    `select r.status, r.dish, r.contact_name, r.contact_email::text as contact_email, r.joined_to_request_id,
            coalesce(h.locked_starts_at, r.locked_starts_at) as starts_at,
            coalesce(h.locked_ends_at, r.locked_ends_at) as ends_at,
            h.status as host_status, r.google_event_id, r.calendar_state
       from request r left join request h on h.id = r.joined_to_request_id
      where r.id = $1 for update of r`,
    [requestId],
  );
  if (!r) return { result: { ok: false, status: 404, reason: 'request_not_found' }, after: noSideEffects() };
  if (r.status === 'cancelled') return { result: { ok: true, already: true }, after: noSideEffects() };
  if (isLazilyDone(r, now))
    return { result: { ok: false, status: 409, reason: 'already_done' }, after: noSideEffects() };

  await c.query(
    `update request set status = 'cancelled', cancelled_at = $2, cancelled_by = $3, awaiting_jon_since = null
      where id = $1`,
    [requestId, now, by],
  );
  await releaseLiveOffers(c, requestId);
  const {
    rows: [audit],
  } = await c.query<{ id: string }>(
    `insert into audit_log (actor, action, request_id, detail) values ($3, 'request_cancelled', $1, $2) returning id`,
    [requestId, JSON.stringify({ from_status: r.status, to_status: 'cancelled' }), by],
  );
  const after = noSideEffects();

  if (r.joined_to_request_id) {
    // Rule 2: only this guest's attendee goes (a patch on the host's event). The host's event is never deleted.
    const patch = await patchHostIfLocked(c, r.joined_to_request_id);
    if (patch) after.outboxIds.push(patch);
  } else {
    // Its own event, if one was made or is on its way (a delete row waits for an in-flight create).
    if (r.google_event_id || r.calendar_state !== 'none') {
      after.outboxIds.push(await enqueueCalendar(c, 'calendar_delete', requestId));
    }
    if (r.status === 'locked') {
      after.emailIds.push(...(await hostLeft(c, requestId, now, audit!.id)));
      // T3.4.05 (AD-6): the guest has the .ics, not Google's invite, so the .ics CANCEL takes it off their calendar.
      if (r.calendar_state === 'ics_sent')
        after.emailIds.push(...(await queueIcsEmail(c, requestId, 'CANCEL')));
    }
  }

  const dish = dishInSentence(r.dish);
  const when = e12When(r);
  const wasLocked = when !== null;
  after.emailIds.push(
    ...queuedId(
      await queueEmail(c, {
        template: by === 'jon' ? 'E17' : 'E11',
        to: r.contact_email,
        requestId,
        eventKey: audit!.id,
        vars: {},
      }),
    ),
  );
  if (by === 'jon') return { result: { ok: true, already: false }, after };
  after.emailIds.push(
    ...queuedId(
      await queueEmail(c, {
        template: 'E12',
        to: jonEmail(),
        requestId,
        eventKey: audit!.id,
        vars: {
          name: r.contact_name,
          dish,
          when: when ?? E12_PARTS.noTime,
          standby: wasLocked
            ? await standbyNames(c, weekStartOf(vancouverDate(r.starts_at!)))
            : E12_PARTS.noWeek,
          adminLink: adminLink(requestId),
        },
      }),
    ),
  );
  return { result: { ok: true, already: false }, after };
}

/** E12: that week's stand-by list (names; Jon-facing only). */
async function standbyNames(c: PoolClient, weekStart: string): Promise<string> {
  const { rows } = await c.query<{ contact_name: string }>(
    `select r.contact_name from request r
      where r.status = 'standby' and r.standby_week = $1 and not r.spam_suspect order by r.created_at`,
    [weekStart],
  );
  return rows.length ? rows.map((s) => s.contact_name).join(', ') : E12_PARTS.nobody;
}

export async function cancelByGuest(requestId: string, now = new Date()): Promise<CancelResult> {
  const { result, after } = await withTx((c) => cancelTx(c, requestId, now, 'guest'));
  await runAfterCommit(after, 'guest_cancel');
  return result;
}

/** T2.9.03: Jon's Cancel for the guest (A3). Same rules as the guest's cancel; E17 to the guest, no E12. */
export async function cancelForGuest(requestId: string, now = new Date()): Promise<CancelResult> {
  const { result, after } = await withTx((c) => cancelTx(c, requestId, now, 'jon'));
  await runAfterCommit(after, 'jon_cancel');
  return result;
}
