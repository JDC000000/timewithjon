// src/features/email/nudge.ts — T3.9.03 (TSD T3.9, §6.4 E3): "Still waiting". 24 h after awaiting_jon_since, one
// E3 per wait: nudged_for takes the wait's timestamp in the SAME transaction that queues the email (event_key =
// that timestamp), so two ticks can't nudge twice and a later wait (a guest re-proposed) gets its own E3.
// Sent after commit; a crash in between leaves the email_log row 'pending' for email-retry.
import 'server-only';
import { getEnv } from '@/config/env';
import { dishBySlug } from '@/content/menu-helpers';
import { withTx } from '@/lib/db';
import { deliverEmail, jonEmail, queueEmail } from './send';

export const NUDGE_AFTER_HOURS = 24;

export async function sendDueNudges(now: Date, deadline: number, batch = 20): Promise<number> {
  let sent = 0;
  while (Date.now() < deadline) {
    const { claimed, ids } = await withTx(async (c) => {
      const { rows } = await c.query<{
        id: string;
        dish: string;
        contact_name: string;
        awaiting_jon_since: Date;
      }>(
        `select r.id, r.dish, r.contact_name, r.awaiting_jon_since
           from request r
          where r.awaiting_jon_since <= $1::timestamptz - make_interval(hours => $2)
            and r.nudged_for is distinct from r.awaiting_jon_since
            and not r.spam_suspect and r.status not in ('cancelled', 'done')
          order by r.awaiting_jon_since
          limit $3 for update of r skip locked`,
        [now, NUDGE_AFTER_HOURS, batch],
      );
      const queued: string[] = [];
      for (const r of rows) {
        await c.query(`update request set nudged_for = awaiting_jon_since where id = $1`, [r.id]);
        const res = await queueEmail(c, {
          template: 'E3',
          to: jonEmail(),
          requestId: r.id,
          eventKey: r.awaiting_jon_since.toISOString(),
          vars: {
            name: r.contact_name,
            dish: dishBySlug(r.dish)?.name ?? r.dish,
            adminLink: `${getEnv().NEXT_PUBLIC_SITE_URL}/admin/requests/${r.id}`,
          },
        });
        if (typeof res !== 'string') queued.push(res.queued);
      }
      return { claimed: rows.length, ids: queued };
    });
    for (const id of ids) if ((await deliverEmail(id, { inline: true, now })) === 'sent') sent++;
    if (claimed < batch) break;
  }
  return sent;
}
