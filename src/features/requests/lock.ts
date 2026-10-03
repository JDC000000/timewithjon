// src/features/requests/lock.ts — T2.3.03 lockRequest(): Lock it in, in ONE transaction (C3 rule 8).
// Order inside the transaction: the request row (FOR UPDATE), then the target week row (FOR UPDATE, which
// serialises every lock in that week, rule 2(e)), then the engine data read AFTER those locks, then canLock.
// A lock writes the status, the audit row, the calendar outbox row and the pending E4 email_log row, and
// commits. Only then, awaited in the same request, the outbox row and the email run (L-3): no Google or mail
// call ever runs inside the transaction. The exclusion constraint and the slot unique index are the last line.
import 'server-only';
import type { PoolClient } from 'pg';
import {
  canLock,
  REFUSAL_MESSAGE,
  type LockRefusal,
  type LockWarning,
} from '@/features/availability/canLock';
import { loadEngineData } from '@/features/availability/load';
import type { CountsToward, RequestStatus, Slot } from '@/features/availability/types';
import { countEvent } from '@/features/analytics/count';
import { manageLink, type EmailVar } from '@/features/email/link-vars';
import { queueEmail } from '@/features/email/send';
import { extendManageTokens } from '@/features/invites/action-tokens';
import { withTx } from '@/lib/db';
import { dayLabel, vancouverDate, weekStartOf } from '@/lib/time';
import { guestWhen } from '@/lib/when';
import { dishName } from './joined-cascade';
import { releaseLiveOffers } from './offers';
import { enqueueCalendar, noSideEffects, queuedId, runAfterCommit, type AfterCommit } from './side-effects';

export type LockTarget =
  { slotId: string } | { startsAt: Date; endsAt: Date; countsToward?: CountsToward; where: string | null }; // no countsToward = the request's

/** T2.4.07: the guest takes an offered time. The lock marks that offer taken (the others are released anyway). */
export interface TakenOffer {
  offerId: string;
  honeypot?: boolean; // AD-9: recorded in the audit row, never a refusal
}

export interface LockInput {
  requestId: string;
  target: LockTarget;
  mode: 'lock';
  overrideWeek?: boolean;
  bookAnyway?: boolean;
  now?: Date;
  /** Set when a guest takes an offer: the audit actor is the guest, and a window another guest's live stand-by
   * offer holds is refused (Jon only gets a warning for it; the engine hides it from everyone else, C3 2(f)). */
  takenOffer?: TakenOffer;
}

export type LockResult =
  | { ok: true; warnings: LockWarning[] }
  | { ok: false; status: 404; reason: 'request_not_found' | 'slot_not_found' }
  | { ok: false; status: 409; reason: LockRefusal; message: string };

export interface RequestRow {
  status: RequestStatus;
  counts_toward: CountsToward;
  dish: string;
  contact_email: string;
  guest_time_zone: string | null;
  joined_to_request_id: string | null;
  locked_where: string | null;
  locked_starts_at: Date | null;
  locked_ends_at: Date | null;
  locked_slot_id: string | null;
  calendar_state: string;
}

/** The database's own double-booking guards (the exclusion constraint and the locked-slot unique index). */
const RANGE_GUARDS = new Set(['request_no_overlap', 'request_locked_slot_uq']);

export function refused(reason: LockRefusal): LockResult {
  return { ok: false, status: 409, reason, message: REFUSAL_MESSAGE[reason] };
}

export type TxOutcome =
  LockResult | { ok: true; warnings: LockWarning[]; after: AfterCommit; auditId: string };
/** The in-transaction outcome of a lock (T2.4.07 composes it with spending the offer token; afterLock runs it). */
export type LockTxOutcome = TxOutcome;

/** Serialise every lock and stand-by offer in the week of `startsAt` (AC2): the seeded week row FOR UPDATE, or a
 * transaction advisory lock on the same week if the row is ever missing. */
export async function lockWeekOf(c: PoolClient, startsAt: Date): Promise<void> {
  const weekStart = weekStartOf(vancouverDate(startsAt));
  const week = await c.query(`select 1 from week where week_start = $1 for update`, [weekStart]);
  if (!week.rowCount) await c.query(`select pg_advisory_xact_lock(hashtext('twj_week:' || $1))`, [weekStart]);
}

/** AD-9: a guest take with the honeypot filled is recorded (its own audit row: the detail keys are fixed). */
export async function recordTakeHoneypot(c: PoolClient, requestId: string, offerId: string): Promise<void> {
  await c.query(
    `insert into audit_log (actor, action, request_id, detail) values ('guest', 'honeypot_filled', $1, $2)`,
    [requestId, JSON.stringify({ offer_id: offerId })],
  );
}

/** The lock itself, inside the caller's transaction (T2.4.07 takes an offer this way). */
export async function lockWithin(c: PoolClient, i: LockInput, now: Date): Promise<LockTxOutcome> {
  return lockTx(c, i, now);
}

/** The request row, locked for the rest of the transaction. */
export async function lockRequestRow(c: PoolClient, requestId: string): Promise<RequestRow | undefined> {
  const { rows } = await c.query<RequestRow>(
    `select status, counts_toward, dish, contact_email::text as contact_email, guest_time_zone,
            joined_to_request_id, locked_where, locked_starts_at, locked_ends_at, locked_slot_id,
            calendar_state::text as calendar_state
       from request where id = $1 for update`,
    [requestId],
  );
  return rows[0];
}

/** E4 vars: the time as the site writes it (QA C, with the guest's own zone) and a manage link minted when the
 * email is sent (T2.3.05). */
export function lockedEmailVars(
  dishSlug: string,
  startsAt: Date,
  endsAt: Date,
  timeZone: string | null,
  requestId: string,
): Record<string, EmailVar> {
  return {
    dish: dishName(dishSlug),
    day: dayLabel(startsAt),
    when: guestWhen(startsAt, endsAt, timeZone),
    manageLink: manageLink(requestId),
  };
}

async function lockTx(c: PoolClient, i: LockInput, now: Date): Promise<TxOutcome> {
  const r = await lockRequestRow(c, i.requestId);
  if (!r) return { ok: false, status: 404, reason: 'request_not_found' };
  // A joined request (T2.10) rides its host and has no range of its own. One whose host left (rule 4: it is
  // needs_new_time and still names the old host) can be locked on its own, which detaches it.
  if (r.joined_to_request_id && r.status === 'locked') return refused('not_lockable');
  return applyLock(c, i, r, now);
}

/**
 * The lock itself, after the request row is locked: the week lock, canLock, the row, the audit row (`action`, or
 * request_locked), the calendar row and the E4. Also used by Promote to host (joined.ts).
 */
export async function applyLock(
  c: PoolClient,
  i: LockInput & { action?: string },
  r: RequestRow,
  now: Date,
): Promise<TxOutcome> {
  let slot: Slot | null = null;
  if ('slotId' in i.target) {
    const {
      rows: [s],
    } = await c.query<{
      id: string;
      date: string;
      window_kind: Slot['windowKind'];
      starts_at: Date;
      ends_at: Date;
    }>(`select id, date::text, window_kind, starts_at, ends_at from slot where id = $1`, [i.target.slotId]);
    if (!s) return { ok: false, status: 404, reason: 'slot_not_found' };
    slot = { id: s.id, date: s.date, windowKind: s.window_kind, startsAt: s.starts_at, endsAt: s.ends_at };
  }
  const range = slot
    ? { startsAt: slot.startsAt, endsAt: slot.endsAt }
    : (i.target as { startsAt: Date; endsAt: Date });
  const countsToward = ('countsToward' in i.target && i.target.countsToward) || r.counts_toward;
  // A slot lock has no place yet. (Change time was removed 2026-09-29: a guest who needs another time emails Jon.)
  const where = 'where' in i.target ? i.target.where : null;

  // PR-G2: a repeat plain Lock in (the leave-commit keepalive POST racing the window's own, or a
  // retry after a lost answer): already locked to exactly this target = done, not a refusal.
  const plainRepeatLock = !i.action && !i.takenOffer && !r.joined_to_request_id;
  if (
    plainRepeatLock &&
    r.status === 'locked' &&
    r.locked_starts_at?.getTime() === range.startsAt.getTime() &&
    r.locked_ends_at?.getTime() === range.endsAt.getTime() &&
    r.locked_where === where &&
    r.locked_slot_id === (slot?.id ?? null) &&
    r.counts_toward === countsToward
  ) {
    return { ok: true, warnings: [] };
  }

  // Serialise every lock in the week. The seeded week row is the lock; if it is ever missing, a transaction
  // advisory lock on the same week keeps the serialisation (review L3) without inventing a week row.
  await lockWeekOf(c, range.startsAt);
  const loaded = await loadEngineData(now, c);
  const verdict = canLock({
    now,
    request: { id: i.requestId, status: r.status, countsToward, dish: r.dish },
    mode: i.mode,
    target: slot ? { slot } : { range },
    bookings: loaded.bookings,
    blocks: loaded.blocks,
    weeks: loaded.weeks,
    offers: loaded.offers,
    settings: loaded.settings,
    overrideWeek: i.overrideWeek,
    bookAnyway: i.bookAnyway,
  });
  if (!verdict.ok) return refused(verdict.reason);
  if (i.takenOffer && verdict.warnings.includes('standby_offer_live')) return refused('time_taken');

  await c.query(
    `update request
        set status = 'locked', locked_slot_id = $2, locked_starts_at = $3, locked_ends_at = $4, locked_where = $5,
            counts_toward = $6, awaiting_jon_since = null, joined_to_request_id = null,
            calendar_state = 'pending'
      where id = $1`,
    [i.requestId, slot?.id ?? null, range.startsAt, range.endsAt, where, countsToward],
  );
  const override = [i.overrideWeek && 'week', i.bookAnyway && 'book_anyway'].filter(Boolean);
  const taken = i.takenOffer;
  const {
    rows: [audit],
  } = await c.query<{ id: string }>(
    `insert into audit_log (actor, action, request_id, detail) values ($4, $1, $2, $3) returning id`,
    [
      i.action ?? (taken ? 'offer_taken' : 'request_locked'),
      i.requestId,
      JSON.stringify({
        from_status: r.status,
        to_status: 'locked',
        slot_id: slot?.id ?? null,
        ...(override.length ? { override } : {}),
        ...(taken ? { offer_id: taken.offerId } : {}),
      }),
      taken ? 'guest' : 'jon',
    ],
  );
  // §6: a lock releases the request's live offers (their windows stop being held at once); a taken offer
  // records what was taken.
  if (taken) {
    // AD-9: a filled honeypot is recorded (its own audit row: the detail keys are fixed), never a refusal.
    if (taken.honeypot) await recordTakeHoneypot(c, i.requestId, taken.offerId);
    await c.query(
      `update offer set taken_at = $2, taken_slot_id = $3, taken_range = $4 where id = $1 and request_id = $5`,
      [
        taken.offerId,
        now,
        slot?.id ?? null,
        slot ? null : JSON.stringify({ starts_at: range.startsAt, ends_at: range.endsAt, where }),
        i.requestId,
      ],
    );
  }
  await releaseLiveOffers(c, i.requestId);
  const after = noSideEffects();
  after.outboxIds.push(await enqueueCalendar(c, 'calendar_create', i.requestId));
  // One E4 per lock: the event key is this audit row, and email_log is unique on template + request + event_key,
  // so a retry never sends it twice (AC6).
  // T2.3.05: every guest email carries a fresh manage link, minted when it is sent (link-vars.ts). Earlier manage
  // links of this request last to the new end + 7 days as well (§6).
  await extendManageTokens(c, i.requestId, range.endsAt);
  after.emailIds.push(
    ...queuedId(
      await queueEmail(c, {
        template: 'E4',
        to: r.contact_email,
        requestId: i.requestId,
        eventKey: audit!.id,
        vars: lockedEmailVars(r.dish, range.startsAt, range.endsAt, r.guest_time_zone, i.requestId),
      }),
    ),
  );
  await countEvent('locked', c); // T3.11, in the lock transaction
  return { ok: true, warnings: verdict.warnings, after, auditId: audit!.id };
}

export function isRangeTaken(e: unknown): boolean {
  const constraint = (e as { constraint?: unknown } | null)?.constraint;
  return typeof constraint === 'string' && RANGE_GUARDS.has(constraint);
}

export async function lockRequest(i: LockInput): Promise<LockResult> {
  const now = i.now ?? new Date();
  let out: TxOutcome;
  try {
    out = await withTx((c) => lockTx(c, i, now));
  } catch (e) {
    // A range locked in ANOTHER week (so not serialised by our week lock) that overlaps: the database says no.
    if (isRangeTaken(e)) return refused('time_taken');
    throw e;
  }
  return afterLock(out);
}

/** After commit, awaited: the calendar rows and the emails of a committed lock (T2.4.07 calls it too). */
export async function afterLock(out: LockTxOutcome): Promise<LockResult> {
  if (!out.ok || !('after' in out)) return out;
  // After commit, awaited (L-3); the calendar rows and the emails side by side, so a slow Google call doesn't hold
  // up the email (review L4). A failure leaves the rows for the tick jobs; the lock itself stands.
  await runAfterCommit(out.after, 'lock');
  return { ok: true, warnings: out.warnings };
}
