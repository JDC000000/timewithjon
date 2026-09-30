// src/features/calendar/ics-email.ts — T3.4.04/.05 (AD-6 fallback): queues E4c, the guest's .ics by email, inside
// the caller's transaction. One rule for SEQUENCE (pr39 F8): 0 for the first .ics a booking ever sends, then +1 for
// each next one (REQUEST -> REQUEST -> CANCEL, and a re-lock after a cancel), bumped in this same transaction, so
// it only ever goes up and a client never ignores an update. The event key is `ics:<sequence>`: one email each.
import 'server-only';
import type { PoolClient } from 'pg';
import { E4C_LEAD, fill } from '@/content/emails';
import { dishBySlug } from '@/content/menu-helpers';
import { queueEmail } from '@/features/email/send';
import { dayLabel, formatGuestTime } from '@/lib/time';
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
  const startsAt = r.locked_starts_at!;
  const event = calendarEvent(requestId, r);
  const dish = dishBySlug(r.dish)?.name ?? r.dish;
  const when = `${dayLabel(startsAt)}, ${formatGuestTime(startsAt, r.guest_time_zone)}`;
  const queued = await queueEmail(c, {
    template: 'E4c',
    to: r.contact_email,
    requestId,
    eventKey: `ics:${r.ics_sequence}`,
    vars: {
      dish,
      lead: fill(E4C_LEAD[method], { dish, when }),
      method,
      requestId,
      sequence: r.ics_sequence,
      startsAt: startsAt.toISOString(),
      endsAt: r.locked_ends_at!.toISOString(),
      summary: event.summary,
      description: event.description,
      attendeeName: r.contact_name,
    },
  });
  return typeof queued === 'object' ? [queued.queued] : [];
}
