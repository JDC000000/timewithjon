// src/features/calendar/ics-email.ts — T3.4.04/.05 (AD-6 fallback): queues E4c, the guest's .ics by email, inside
// the caller's transaction. One rule for SEQUENCE (pr39 F8): 0 for the first .ics a booking ever sends, then +1 for
// each next one (REQUEST -> REQUEST -> CANCEL, and a re-lock after a cancel), bumped in this same transaction, so
// it only ever goes up and a client never ignores an update. The event key is `ics:<sequence>`: one email each.
// The ORGANIZER is fixed by the first .ics too: worked out when sequence 0 is queued, kept in that row's vars and
// copied to every later one, so a mailer switch between a REQUEST and its CANCEL can't change the organiser of the
// same UID (clients may ignore a CANCEL from a different organiser).
import 'server-only';
import type { PoolClient } from 'pg';
import { E4C_LEAD, fill } from '@/content/emails';
import { dishInSentence } from '@/content/menu-helpers';
import { queueEmail } from '@/features/email/send';
import { guestWhen } from '@/lib/when';
import { icsOrganizer } from './ics-attachment';
import { calendarEvent, LOCKED_COLUMNS, type LockedRow } from './event';
import type { IcsMethod } from './ics';

/**
 * Queues one E4c for the booking's locked time (read now: call it before a cancel clears the time). Returns the
 * email_log id to deliver after commit, or nothing (no locked time, or the address is suppressed).
 */
export async function queueIcsEmail(c: PoolClient, requestId: string, method: IcsMethod): Promise<string[]> {
  await c.query(`select r.id from request r where r.id = $1 for update`, [requestId]); // the bump reads under the lock
  const {
    rows: [r],
  } = await c.query<LockedRow & { ics_sequence: number; guest_time_zone: string | null }>(
    `update request
        set ics_sequence = ics_sequence + case when exists (select 1 from email_log l
                                                              where l.request_id = $1 and l.template = 'E4c')
                                               then 1 else 0 end
      where id = $1 and locked_starts_at is not null and locked_ends_at is not null
      returning ${LOCKED_COLUMNS}, ics_sequence, guest_time_zone`,
    [requestId],
  );
  if (!r) return [];
  const organizerEmail = await seriesOrganizer(c, requestId);
  const startsAt = r.locked_starts_at!;
  const event = calendarEvent(requestId, r, [], true); // the guest's own file: their title (Q2)
  const dish = dishInSentence(r.dish);
  // CANCEL's lead starts its sentence with the dish: a capital there ("A hike or nature moment, Sat Jun 5, is off.")
  const leadDish = method === 'CANCEL' ? dish.charAt(0).toUpperCase() + dish.slice(1) : dish;
  const when = guestWhen(startsAt, r.locked_ends_at!, r.guest_time_zone); // QA C: the email's words, not the .ics
  const queued = await queueEmail(c, {
    template: 'E4c',
    to: r.contact_email,
    requestId,
    eventKey: `ics:${r.ics_sequence}`,
    vars: {
      dish,
      lead: fill(E4C_LEAD[method], { dish: leadDish, when }),
      method,
      requestId,
      sequence: r.ics_sequence,
      startsAt: startsAt.toISOString(),
      endsAt: r.locked_ends_at!.toISOString(),
      summary: event.summary,
      description: event.description,
      attendeeName: r.contact_name,
      ...(organizerEmail ? { organizerEmail } : {}),
    },
  });
  return typeof queued === 'object' ? [queued.queued] : [];
}

/**
 * The organiser address for this booking's .ics series: the one the first E4c stored, or, for the first one, the
 * address it is worked out to now. null for a series whose first E4c predates this (it is worked out at send time,
 * as before).
 */
async function seriesOrganizer(c: PoolClient, requestId: string): Promise<string | null> {
  const {
    rows: [first],
  } = await c.query<{ organizer: string | null }>(
    `select vars->>'organizerEmail' as organizer from email_log
      where request_id = $1 and template = 'E4c' order by created_at, id limit 1`,
    [requestId],
  );
  if (first) return first.organizer;
  return (await icsOrganizer()).email;
}
