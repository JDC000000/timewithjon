// src/features/calendar/resync.ts — T3.15.02 (TSD T3.15, L10): A7 "Re-sync calendar". After a deleted calendar,
// a reconnect to a new one, or drift, every future locked booking gets ONE outbox row that inserts its event with
// the deterministic id (outbox.ts, payload {resync: true}): a missing event is made, an existing one answers 409
// and converges, so each event exists exactly once however often Jon presses it. Past bookings are untouched.
// - 'ics_sent' bookings stay 'ics_sent': calendarEvent() leaves the guest off, so Google emails them nothing (they
//   have the .ics); only Jon's calendar is repaired. Their open retry rows (the backlog) are replaced by this one.
// - Every other IDLE open create/patch row of those bookings is closed too (never tried, failed and waiting, or
//   its lease lapsed): a patch aimed at an event on a deleted calendar would only fail for an hour first. pr57 F1:
//   a row IN FLIGHT (claimed: attempts > 0, last_error null, lease running) stays open, so the re-sync row (and
//   any later delete or patch) waits for it; closing it would let a stale insert revive a cancelled event or put
//   back old times after the others ran. If it then fails, processOutbox closes it in favour of the re-sync row.
//   Delete rows are left alone (they belong to cancelled bookings).
// - The rows are written in one transaction, then run inline: rows START within a 20 s budget and every Google
//   call ends by a hard stop (pr57 F2), so the request stays well under maxDuration 60; the tick does the rest.
import 'server-only';
import { getEnv } from '@/config/env';
import { withTx } from '@/lib/db';
import { withGoogleDeadline } from '@/lib/adapters/google/http';
import { report } from '@/lib/report';
import { GoogleNotConnectedError, loadConnection } from './connection';
import { processOutbox } from './outbox';

/** How long the button's request spends syncing inline before leaving the rest to the tick. */
export const RESYNC_INLINE_BUDGET_MS = 20_000;
/**
 * pr57 F2: one row can make up to 4 Google calls (refresh, insert 409, GET, PATCH) of up to 15 s each plus a
 * retry wait, so rows only start within the budget and every Google call is cut off here (route maxDuration 60).
 */
export const RESYNC_HARD_STOP_MS = 45_000;

export interface ResyncResult {
  /** Future locked bookings queued for a re-sync. */
  queued: number;
  /** Of those, synced before the response. */
  synced: number;
}

/** The real gateway needs a live grant and the stored app calendar; proto and previews use the mock. */
async function assertCalendarReady(): Promise<void> {
  if (getEnv().APP_MODE === 'prototype') return;
  const row = await loadConnection();
  if (!row?.refresh_token_enc || !row.calendar_id) {
    throw new GoogleNotConnectedError('Re-sync needs a connected calendar');
  }
}

/** One transaction: close the open create/patch rows and queue one re-sync row per future locked booking. */
export async function queueResync(now: Date): Promise<string[]> {
  return withTx(async (c) => {
    // Two presses at once would queue two rows per booking (harmless, but twice the calls): run one at a time.
    await c.query(`select pg_advisory_xact_lock(hashtext('twj:calendar_resync'))`);
    const { rows } = await c.query<{ id: string }>(
      `with target as (
         select r.id, r.locked_starts_at from request r
          where r.status = 'locked' and r.joined_to_request_id is null and r.locked_ends_at > $1
            -- pr57 F4: a joined row has no range under the current writers (joined.ts nulls it; the joined
            -- cascade moves it to needs_new_time); this clause keeps joined rows out even if one ever had one.
       ),
       closed as (
         update outbox o set done_at = now()
          where o.request_id in (select t.id from target t) and o.done_at is null
            and o.kind in ('calendar_create', 'calendar_patch')
            and (o.attempts = 0 or o.last_error is not null or o.next_attempt_at <= $1)
       ),
       pending as (
         update request r set calendar_state = 'pending'
          where r.id in (select t.id from target t) and r.status = 'locked' and r.calendar_state <> 'ics_sent'
       )
       insert into outbox (kind, request_id, payload)
       select 'calendar_create', t.id, '{"resync": true}'::jsonb from target t order by t.locked_starts_at, t.id
       returning id`,
      [now],
    );
    return rows.map((r) => r.id);
  });
}

/** A7 "Re-sync calendar": queue every future locked booking, then sync the soonest ones inline. */
export async function resyncCalendar(
  now = new Date(),
  budgetMs = RESYNC_INLINE_BUDGET_MS,
  hardStopMs = RESYNC_HARD_STOP_MS,
): Promise<ResyncResult> {
  await assertCalendarReady();
  const ids = await queueResync(now);
  const started = Date.now();
  const startBy = started + Math.min(budgetMs, hardStopMs);
  let synced = 0;
  try {
    // A row cut off by the hard stop fails like a timeout (retryable): the tick retries it; its event id is
    // deterministic, so an insert that did reach Google converges on the retry.
    await withGoogleDeadline(started + hardStopMs, async () => {
      for (const id of ids) {
        if (Date.now() > startBy) break;
        if ((await processOutbox(id, { inline: true, now })) === 'synced') synced++;
      }
    });
  } catch (e) {
    // The rows are committed: the tick's outbox retry finishes them.
    report(e, { area: 'calendar_resync' });
  }
  return { queued: ids.length, synced };
}
