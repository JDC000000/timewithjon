// src/features/requests/joined.ts — T2.10.01 Join to booking and T2.10.04 Promote to host (TSD T2.10, §6
// "Joined requests"). One transaction each, rows locked host first, then the joined request (the order the
// host's own cancel takes through hostLeft), so the two never deadlock. Google and the mailer run after commit.
import 'server-only';
import type { PoolClient } from 'pg';
import type { LockRefusal } from '@/features/availability/canLock';
import type { CountsToward } from '@/features/availability/types';
import { queueEmail } from '@/features/email/send';
import { extendManageTokens } from '@/features/invites/action-tokens';
import { withTx } from '@/lib/db';
import { cascadeToJoined } from './joined-cascade';
import {
  applyLock,
  isRangeTaken,
  lockedEmailVars,
  lockRequestRow,
  refused,
  type LockResult,
  type LockTarget,
  type TxOutcome,
} from './lock';
import { releaseLiveOffers } from './offers';
import { enqueueCalendar, noSideEffects, queuedId, runAfterCommit } from './side-effects';

export type JoinRefusal = 'host_not_locked' | 'host_still_locked' | 'no_host_range' | 'not_joined';
export const JOIN_REFUSAL_MESSAGE: Record<JoinRefusal, string> = {
  host_not_locked: 'That booking isn’t locked in any more.',
  host_still_locked: 'That booking is still on. Join it instead.',
  no_host_range: 'That booking has no time to copy. Lock it in instead.',
  not_joined: 'That request isn’t joined to a booking.',
};

export type JoinResult =
  | LockResult
  | { ok: false; status: 404; reason: 'host_not_found' }
  | { ok: false; status: 409; reason: JoinRefusal; message: string };

const JOINABLE = new Set(['requested', 'needs_new_time', 'standby']);

/** Why a request in this (non-joinable) status can't join a booking. */
function notJoinable(status: string): LockRefusal {
  if (status === 'cancelled') return 'cancelled';
  return status === 'locked' || status === 'done' ? 'already_locked' : 'not_lockable';
}

function joinRefused(reason: JoinRefusal): JoinResult {
  return { ok: false, status: 409, reason, message: JOIN_REFUSAL_MESSAGE[reason] };
}

interface HostRow {
  status: string;
  counts_toward: CountsToward;
  joined_to_request_id: string | null;
  locked_starts_at: Date | null;
  locked_ends_at: Date | null;
  locked_where: string | null;
  locked_slot_id: string | null;
}

async function lockHostRow(c: PoolClient, hostId: string): Promise<HostRow | undefined> {
  const { rows } = await c.query<HostRow>(
    `select status, counts_toward, joined_to_request_id, locked_starts_at, locked_ends_at, locked_where,
            locked_slot_id
       from request where id = $1 for update`,
    [hostId],
  );
  return rows[0];
}

type JoinOutcome = JoinResult | Extract<TxOutcome, { after: unknown }>;

async function joinTx(c: PoolClient, requestId: string, hostId: string, now: Date): Promise<JoinOutcome> {
  if (requestId === hostId) return refused('not_lockable');
  // pr52-verify N1: a joiner that can't join is refused before any lock. Otherwise joining a LOCKED booking onto
  // a host would hold the host and wait on the joiner, while block-confirm holds both (by id): 40P01.
  // Same refusal order as after the locks: unknown request, unknown host, then the joiner's status.
  // Accepted (pr63 L1): the check can't close every window. If, between it and our locks, the joiner is locked into
  // a range and a block-confirm then holds it (lower id) and waits on our host, Postgres aborts one side (40P01): a
  // 500, nothing half-written; Jon taps again. That needs three near-simultaneous actions, so there's no retry loop.
  const { rows: peek } = await c.query<{ id: string; status: string }>(
    `select id, status from request where id = any($1::uuid[])`,
    [[requestId, hostId]],
  );
  const joiner = peek.find((p) => p.id === requestId);
  if (!joiner) return { ok: false, status: 404, reason: 'request_not_found' };
  if (!peek.some((p) => p.id === hostId)) return { ok: false, status: 404, reason: 'host_not_found' };
  if (!JOINABLE.has(joiner.status)) return refused(notJoinable(joiner.status));
  // Host row first, before any write: block-confirm's cascade holds this lock (pr59-review M2).
  const h = await lockHostRow(c, hostId);
  const r = await lockRequestRow(c, requestId);
  if (!r) return { ok: false, status: 404, reason: 'request_not_found' };
  if (!h) return { ok: false, status: 404, reason: 'host_not_found' };
  if (!JOINABLE.has(r.status)) return refused(notJoinable(r.status)); // changed since the peek
  // The host is a live booking of its own: locked, not joined to another, and not yet over (lazy done, AD-8).
  if (h.status !== 'locked' || h.joined_to_request_id || !h.locked_ends_at || h.locked_ends_at <= now) {
    return joinRefused('host_not_locked');
  }

  // No range and no cap count of its own (rule 1): times, place and done come from the host.
  await c.query(
    `update request
        set status = 'locked', joined_to_request_id = $2, locked_slot_id = null, locked_starts_at = null,
            locked_ends_at = null, locked_where = null, awaiting_jon_since = null
      where id = $1`,
    [requestId, hostId],
  );
  await releaseLiveOffers(c, requestId);
  const {
    rows: [audit],
  } = await c.query<{ id: string }>(
    `insert into audit_log (actor, action, request_id, detail) values ('jon', 'request_joined', $1, $2) returning id`,
    [requestId, JSON.stringify({ from_status: r.status, to_status: 'locked' })],
  );
  const after = noSideEffects();
  // The host's event gains this attendee: attendees are derived from the locked joined rows (outbox.ts).
  after.outboxIds.push(await enqueueCalendar(c, 'calendar_patch', hostId));
  await extendManageTokens(c, requestId, h.locked_ends_at);
  after.emailIds.push(
    ...queuedId(
      await queueEmail(c, {
        template: 'E4',
        to: r.contact_email,
        requestId,
        eventKey: audit!.id,
        vars: lockedEmailVars(r.dish, h.locked_starts_at!, r.guest_time_zone, requestId),
      }),
    ),
  );
  return { ok: true, warnings: [], after, auditId: audit!.id };
}

/** T2.10.01 Join to booking: the request rides a locked booking (AC1, AC2). */
export async function joinToBooking(
  requestId: string,
  hostId: string,
  now = new Date(),
): Promise<JoinResult> {
  const out = await withTx((c) => joinTx(c, requestId, hostId, now));
  if (!out.ok || !('after' in out)) return out;
  await runAfterCommit(out.after, 'join');
  return { ok: true, warnings: [] };
}

interface PromoteOptions {
  overrideWeek?: boolean;
  bookAnyway?: boolean;
  now?: Date;
}

async function promoteTx(
  c: PoolClient,
  requestId: string,
  o: PromoteOptions,
  now: Date,
): Promise<JoinOutcome> {
  // Host first (see the header): find the old host, lock it, then lock the request and check it still names it.
  const { rows: peek } = await c.query<{ joined_to_request_id: string | null }>(
    `select r.joined_to_request_id from request r where r.id = $1`,
    [requestId],
  );
  if (!peek[0]) return { ok: false, status: 404, reason: 'request_not_found' };
  const hostId = peek[0].joined_to_request_id;
  if (!hostId) return joinRefused('not_joined');
  const h = await lockHostRow(c, hostId);
  const r = await lockRequestRow(c, requestId);
  if (!r) return { ok: false, status: 404, reason: 'request_not_found' };
  if (r.joined_to_request_id !== hostId) return joinRefused('not_joined');
  // pr52-review M1: the other guests of the old host are locked NOW, before applyLock takes the week row, so every
  // request row is locked before the week (the order lockTx takes: request, then week). A concurrent Lock it in on
  // one of them then waits here or finishes first; it can never deadlock with this promote.
  await c.query(
    `select s.id from request s where s.joined_to_request_id = $1 and s.id <> $2 order by s.created_at, s.id for update`,
    [hostId, requestId],
  );
  // Only a guest the host left behind (rule 4): needs_new_time, still naming a host that is no longer on.
  if (r.status !== 'needs_new_time') {
    return refused(
      r.status === 'cancelled' ? 'cancelled' : r.status === 'locked' ? 'already_locked' : 'not_lockable',
    );
  }
  if (h && (h.status === 'locked' || h.status === 'done')) return joinRefused('host_still_locked');
  // The old host's booking (range, place, cap kind) as copied onto this row when the host left (hostLeft), else
  // the host's own row.
  const src = r.locked_starts_at ? r : h;
  const startsAt = src?.locked_starts_at ?? null;
  const endsAt = src?.locked_ends_at ?? null;
  if (!src || !startsAt || !endsAt) return joinRefused('no_host_range');
  const countsToward = src.counts_toward;
  const target: LockTarget = src.locked_slot_id
    ? { slotId: src.locked_slot_id }
    : { startsAt, endsAt, countsToward, where: src.locked_where };
  // canLock is re-checked for the copied range (its own row is a needs_new_time request, so 'lock' mode).
  const locked = await applyLock(
    c,
    {
      requestId,
      target,
      mode: 'lock',
      overrideWeek: o.overrideWeek,
      bookAnyway: o.bookAnyway,
      action: 'request_promoted',
    },
    { ...r, counts_toward: countsToward },
    now,
  );
  if (!locked.ok || !('after' in locked)) return locked;
  // The others the old host left behind ride the new host (the create row made above lists them as attendees),
  // each with an audit row and an E4 (cascadeToJoined reads the new host's locked joined rows).
  const { rows: moved } = await c.query<{ id: string }>(
    `update request
        set joined_to_request_id = $2, status = 'locked', awaiting_jon_since = null, locked_slot_id = null,
            locked_starts_at = null, locked_ends_at = null, locked_where = null
      where joined_to_request_id = $1 and status = 'needs_new_time' and id <> $2
      returning id`,
    [hostId, requestId],
  );
  for (const m of moved) {
    await c.query(
      `insert into audit_log (actor, action, request_id, detail) values ('jon', 'host_promoted', $1, $2)`,
      [m.id, JSON.stringify({ from_status: 'needs_new_time', to_status: 'locked' })],
    );
  }
  locked.after.emailIds.push(
    ...(await cascadeToJoined(c, requestId, {
      template: 'E4',
      eventKey: locked.auditId,
      now,
      extendLinksTo: endsAt,
      vars: (j) => lockedEmailVars(j.dish, startsAt, j.guest_time_zone, j.id),
    })),
  );
  return locked;
}

/** T2.10.04 Promote to host (rule 4): the promoted guest gets the old host's range and a new event with all of them. */
export async function promoteToHost(requestId: string, o: PromoteOptions = {}): Promise<JoinResult> {
  const now = o.now ?? new Date();
  let out: JoinOutcome;
  try {
    out = await withTx((c) => promoteTx(c, requestId, o, now));
  } catch (e) {
    if (isRangeTaken(e)) return refused('time_taken');
    throw e;
  }
  if (!out.ok || !('after' in out)) return out;
  await runAfterCommit(out.after, 'promote');
  return { ok: true, warnings: out.warnings };
}
