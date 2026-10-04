// src/features/calendar/outbox.ts — T2.3.02 the calendar outbox processor (AD-6, L-3). Idempotent.
// A calendar row doesn't snapshot the event: it syncs the request's CURRENT locked state to Google (insert when
// there's no google_event_id yet, patch otherwise). So a retry, or a create and a later patch, converge.
// Like the email path (send.ts), a row is claimed with one atomic UPDATE and Google is called with no
// transaction open and no row lock held (L-3). A request's calendar rows run oldest first: a row waits while an
// older one for the same request is still retryable, so two passes can't both insert.
// T2.7: a delete row removes the request's event (read at run time, so a delete queued while the create was
// still in flight waits for it and then removes what it made), and the attendee list is derived too: the host
// plus every guest joined to it that is still locked (§6 "Joined requests" rules 2, 3 and 5), so removing a
// joined guest is just a patch row on the host.
// T3.4.04 (AD-6): a create/patch out of tries sends the guest one .ics (E4c) and keeps retrying the attendee-less
// event with fresh rows (outOfAttempts). pr39 F4: a row also waits for an older one still in flight on its LAST try,
// so a delete can never run beside a create that is still inserting.
// T3.15.02: a row with payload {resync: true} (resync.ts) inserts even when the request has an event id.
// A row with payload {attendees: true} (a joined guest came or went) patches the attendee list too; a plain
// patch sends time and text only, so without it Google would never hear of the change.
import 'server-only';
import { deliverEmail } from '@/features/email/send';
import { adapters } from '@/lib/adapters';
import { CalendarWriteGuardError, googleEventId } from '@/lib/adapters/google/calendar';
import { q, withTx } from '@/lib/db';
import { errorName, report } from '@/lib/report';
import { calendarEvent, LOCKED_COLUMNS, type LockedRow } from './event';
import { GoogleNotConnectedError } from './connection';
import { queueIcsEmail } from './ics-email';

export const OUTBOX_MAX_ATTEMPTS = 4;
const CALENDAR_KINDS = `('calendar_create','calendar_patch','calendar_delete')`;
export type OutboxResult = 'synced' | 'failed' | 'skipped' | 'not_locked';

/**
 * Process one create/patch row. `inline` = the request that wrote it (right after commit), which may claim a
 * never-tried row at once; the tick claims only rows whose next_attempt_at has passed.
 */
export async function processOutbox(
  id: string,
  opts: { inline: boolean; now?: Date },
): Promise<OutboxResult> {
  const [claimed] = await q<{
    request_id: string;
    attempts: number;
    kind: string;
    resync: boolean;
    attendees: boolean;
  }>(
    `update outbox o
        set attempts = o.attempts + 1, last_error = null,
            next_attempt_at = coalesce($3, now()) + case o.attempts when 0 then interval '5 minutes'
                                                                  when 1 then interval '15 minutes'
                                                                  else interval '30 minutes' end
      where o.id = $1 and o.done_at is null and o.kind in ${CALENDAR_KINDS}
        and o.request_id is not null and o.attempts < ${OUTBOX_MAX_ATTEMPTS}
        and ((o.attempts = 0 and $2) or o.next_attempt_at <= coalesce($3, now()))
        and not exists (select 1 from outbox older
                         where older.request_id = o.request_id and older.id <> o.id
                           and older.kind in ${CALENDAR_KINDS} and older.done_at is null
                           and (older.attempts < ${OUTBOX_MAX_ATTEMPTS} or older.next_attempt_at > coalesce($3, now()))
                           and (older.created_at, older.id) < (o.created_at, o.id))
      returning o.request_id, o.attempts, o.kind, coalesce((o.payload->>'resync')::boolean, false) as resync,
                coalesce((o.payload->>'attendees')::boolean, false) as attendees`,
    [id, opts.inline, opts.now ?? null],
  );
  // pr57 F1: the claim clears last_error, so "attempts > 0, last_error null, lease not lapsed" = IN FLIGHT: a
  // Re-sync leaves such a row open (resync.ts), and every newer row of the request keeps waiting for it below.
  if (!claimed) return 'skipped'; // done, in flight, not due, out of attempts, or waiting on an older row
  const now = opts.now ?? new Date();
  const requestId = claimed.request_id;
  try {
    if (claimed.kind === 'calendar_delete') return await deleteEvent(id, requestId);
    const [r] = await q<LockedRow>(
      `select ${LOCKED_COLUMNS} from request where id = $1 and joined_to_request_id is null`,
      [requestId],
    );
    if (!r || r.status !== 'locked' || !r.locked_starts_at || !r.locked_ends_at) {
      // Moved on before we ran (cancelled, suggested elsewhere): nothing to sync; a delete row handles removal.
      await q(`update outbox set done_at = now(), last_error = null where id = $1`, [id]);
      return 'not_locked';
    }
    const joined = await q<{ contact_email: string }>(
      `select contact_email::text as contact_email from request
        where joined_to_request_id = $1 and status = 'locked' order by created_at, id`,
      [requestId],
    );
    const event = calendarEvent(
      requestId,
      r,
      joined.map((j) => j.contact_email),
    );
    const cal = adapters().calendar;
    // T3.15.02: a re-sync row always inserts. The id is deterministic, so an event that is still there answers
    // 409 and converges (a cancelled one is revived); one lost with a deleted calendar is made again, once.
    if (r.google_event_id && !claimed.resync) {
      await cal.patch(r.google_event_id, event, claimed.attendees ? { attendees: true } : undefined);
    } else {
      const { eventId } = await cal.insert(event);
      // Stored at once, before done_at: a failure after this point retries as a patch, never a second insert.
      await q(`update request set google_event_id = $2 where id = $1 and google_event_id is null`, [
        requestId,
        eventId,
      ]);
    }
    // 'synced' only when no newer calendar row is still open (review L2): a create that read the old time and
    // finishes after a newer patch (a joined-guest change) committed must not report the old time as synced.
    await q(
      `with done as (update outbox set done_at = now(), last_error = null where id = $1)
       update request set calendar_state = case when calendar_state = 'ics_sent' then calendar_state else 'synced' end
        where id = $2
          and not exists (select 1 from outbox o
                           where o.request_id = $2 and o.id <> $1 and o.kind in ${CALENDAR_KINDS}
                             and o.done_at is null and o.attempts < ${OUTBOX_MAX_ATTEMPTS})`,
      [id, requestId],
    );
    return 'synced';
  } catch (e) {
    // pr57 F1: a create/patch that fails while a NEWER re-sync row is open is closed rather than retried: the
    // re-sync row syncs the current state anyway, and a retry would hold it back for up to an hour.
    await q(
      `update outbox o set last_error = $2,
              done_at = case when o.kind in ('calendar_create', 'calendar_patch') and exists (
                          select 1 from outbox n
                           where n.request_id = o.request_id and n.id <> o.id and n.done_at is null
                             and n.kind = 'calendar_create' and coalesce((n.payload->>'resync')::boolean, false)
                             and (n.created_at, n.id) > (o.created_at, o.id)) then now() end
        where o.id = $1`,
      [id, errorName(e).slice(0, 200)],
    );
    report(e, { area: 'calendar', attempt: String(claimed.attempts) });
    if (claimed.attempts >= OUTBOX_MAX_ATTEMPTS) await outOfAttempts(id, requestId, claimed.kind, now);
    return 'failed';
  }
}

/**
 * T3.4.04 (AD-6): a row out of tries. If the guest has no Google invite (no event made yet) and the booking is still
 * ahead, they get ONE .ics (E4c REQUEST) and the booking turns 'ics_sent'. For an 'ics_sent' booking the row is
 * closed and, while the booking is ahead, a fresh row (its own tries, first one on the next step of the cadence)
 * keeps retrying the attendee-less event, so Jon's calendar still ends up right (a create/patch never turns an
 * 'ics_sent' booking 'failed'). Anything else is 'failed' for admin: an event exists but won't update, or a
 * delete won't go through (the guest already has the .ics CANCEL, but the event is still on Jon's calendar).
 */
async function outOfAttempts(id: string, requestId: string, kind: string, now: Date): Promise<void> {
  const emailIds = await withTx(async (c) => {
    // pr54 F1: only while the row is still open and out of tries. Two overlapping ticks (or a sweep and a retry)
    // can both reach here for one row: the second waits on this lock, then finds it closed and does nothing.
    const { rowCount } = await c.query(
      `select 1 from outbox where id = $1 and done_at is null and attempts >= ${OUTBOX_MAX_ATTEMPTS} for update`,
      [id],
    );
    if (!rowCount) return [];
    const {
      rows: [r],
    } = await c.query<{
      status: string;
      google_event_id: string | null;
      calendar_state: string;
      ahead: boolean;
    }>(
      `select status, google_event_id, calendar_state::text as calendar_state,
              coalesce(locked_ends_at > $2, false) as ahead
         from request where id = $1 for update`,
      [requestId, now],
    );
    const live = r?.status === 'locked' && r.ahead;
    if (
      !r ||
      kind === 'calendar_delete' ||
      (r.calendar_state !== 'ics_sent' && (!live || r.google_event_id))
    ) {
      await c.query(`update request set calendar_state = 'failed' where id = $1`, [requestId]);
      return [];
    }
    const queued = r.calendar_state === 'ics_sent' ? [] : await queueIcsEmail(c, requestId, 'REQUEST');
    await c.query(
      `with closed as (update outbox set done_at = now() where id = $1 and done_at is null)
       update request set calendar_state = 'ics_sent' where id = $2`,
      [id, requestId],
    );
    if (live) {
      // The payload carries over, so a re-sync row's successor still inserts (T3.15.02).
      await c.query(
        `insert into outbox (kind, request_id, next_attempt_at, payload)
         select $1::outbox_kind, $2::uuid, $3::timestamptz + interval '5 minutes', o.payload from outbox o where o.id = $4`,
        [kind, requestId, now, id],
      );
    }
    return queued;
  });
  for (const e of emailIds) await deliverEmail(e, { inline: true });
}

/**
 * A delete row: remove the event the request has now, if any. google_event_id is cleared only if it is still
 * the one removed, and calendar_state goes back to 'none' unless the request was locked again meanwhile (a
 * newer create row then inserts a fresh event).
 */
async function deleteEvent(id: string, requestId: string): Promise<OutboxResult> {
  const [r] = await q<{ google_event_id: string | null }>(
    `select r.google_event_id from request r where r.id = $1`,
    [requestId],
  );
  // pr57-verify V2: no stored id may still mean an event: an insert Google accepted but whose answer never came
  // back (a timeout, the re-sync hard stop). Its id is deterministic, so remove that; 404/410 = nothing there = done.
  if (r) {
    try {
      await adapters().calendar.remove(r.google_event_id ?? googleEventId(requestId));
    } catch (e) {
      // pr64-review N1: no stored id AND no calendar we may write to (no grant / a Disconnect, or the write guard
      // refuses the stored calendar): there is no event we could delete, so close the row now, as before #64,
      // instead of 5 retries ending in 'failed' on a cancelled booking. A stored id still retries (it is real).
      const unreachable = e instanceof GoogleNotConnectedError || e instanceof CalendarWriteGuardError;
      if (r.google_event_id !== null || !unreachable) throw e;
    }
  }
  await q(
    `with done as (update outbox set done_at = now(), last_error = null where id = $1)
     update request set google_event_id = null,
                        calendar_state = case when status = 'locked' then calendar_state else 'none' end
      where id = $2 and google_event_id is not distinct from $3`,
    [id, requestId, r?.google_event_id ?? null],
  );
  return 'synced';
}

/** Tick job body: due calendar rows, oldest first, in batches until none are due or the budget runs out. */
export async function retryDueOutbox(
  now: Date,
  deadline: number,
  batch = 20,
  maxBatches = 10,
): Promise<number> {
  // A crash or timeout DURING the last try skips the catch in processOutbox: its lease has run out, no try is
  // left, and the request would show 'pending' forever (review L1). Give it the out-of-tries handling now: the
  // .ics fallback, or 'failed' so admin sees it. Each outcome leaves the row unmatched here, so it runs once.
  const stranded = await q<{ id: string; request_id: string; kind: string }>(
    `select o.id, o.request_id, o.kind::text as kind from outbox o join request r on r.id = o.request_id
      where r.calendar_state in ('pending', 'ics_sent') and o.kind in ('calendar_create','calendar_patch')
        and o.done_at is null and o.attempts >= ${OUTBOX_MAX_ATTEMPTS} and o.next_attempt_at <= $1
      order by o.created_at, o.id`,
    [now],
  );
  for (const s of stranded) await outOfAttempts(s.id, s.request_id, s.kind, now);
  let synced = 0;
  for (let i = 0; i < maxBatches && Date.now() < deadline; i++) {
    const due = await q<{ id: string }>(
      `select id from outbox where done_at is null and kind in ${CALENDAR_KINDS}
          and attempts < ${OUTBOX_MAX_ATTEMPTS} and next_attempt_at <= $1
        order by created_at, id limit $2`,
      [now, batch],
    );
    if (due.length === 0) break;
    let claimedAny = false;
    for (const r of due) {
      if (Date.now() > deadline) return synced;
      const res = await processOutbox(r.id, { inline: false, now });
      if (res !== 'skipped') claimedAny = true;
      if (res === 'synced') synced++;
    }
    if (!claimedAny) break; // every due row is waiting on an older one: nothing more this tick
  }
  return synced;
}
