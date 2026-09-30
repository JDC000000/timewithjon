// src/features/email/queue.ts — T3.2.05: the next-UTC-day queue (AD-5 rule 4). From 00:05 UTC the tick sends
// due rows in priority, then age, order. pr31 review M2: one statement claims the queue row (`sent_at is null`,
// skip locked) AND re-arms its email_log row as 'pending', so a crash between the two can't strand a row: a
// claimed row is either still waiting, or 'pending' and due for email-retry.
import 'server-only';
import { q } from '@/lib/db';
import type { AppPriority } from './guard';
import { deliverEmail } from './send';

export interface QueueClaim {
  id: string;
  priority: AppPriority;
  /** false when the email_log row was no longer 'queued' (e.g. Jon re-sent it): nothing to deliver. */
  armed: boolean;
}

/** Claims the next due queue row, or null when none is due (or every due row is locked by another runner). */
export async function claimQueued(now: Date): Promise<QueueClaim | null> {
  const [claimed] = await q<QueueClaim>(
    `with c as (
       update email_queue set sent_at = now()
        where sent_at is null
          and id = (select eq.id from email_queue eq join email_log l on l.id = eq.email_log_id
                     where eq.kind = 'next_day' and eq.sent_at is null and eq.not_before <= $1
                     order by eq.priority, l.created_at
                     limit 1 for update of eq skip locked)
        returning email_log_id, priority
     ), armed as (
       update email_log l set status = 'pending', next_attempt_at = $1
         from c where l.id = c.email_log_id and l.status = 'queued' returning l.id
     )
     select c.email_log_id as id, c.priority, armed.id is not null as armed
       from c left join armed on armed.id = c.email_log_id`,
    [now],
  );
  return claimed ?? null;
}

export async function sendQueuedEmails(now: Date, deadline: number, max = 50): Promise<number> {
  let sent = 0;
  for (let i = 0; i < max && Date.now() < deadline; i++) {
    const claimed = await claimQueued(now);
    if (!claimed) break;
    if (!claimed.armed) continue;
    // Still full (a busy day again): deliverEmail parks it for the next 00:05, past `now`, so it isn't re-claimed.
    if ((await deliverEmail(claimed.id, { inline: false, now, priority: claimed.priority })) === 'sent')
      sent++;
  }
  return sent;
}
