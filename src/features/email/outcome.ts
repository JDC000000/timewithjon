// src/features/email/outcome.ts — T3.13.02: apply Resend's delivery outcome (TSD H3). A bounce or complaint
// on a sent row: email_log gets the status, the address is suppressed (queueEmail refuses it; its unsent rows
// become 'suppressed'), and for a guest email the request shows contact_problem and lands in Needs a reply
// (awaiting_jon_since; an existing wait keeps its start). Idempotent: a second report changes nothing.
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { getEnv } from '@/config/env';
import { JON_FACING, type TemplateId } from '@/content/emails';
import { reportMessage } from '@/lib/report';
import { jonEmail } from './send';

export type DeliveryEvent = 'delivered' | 'bounced' | 'complained' | 'pending';
type Db = Pool | PoolClient;
const OPEN_REQUEST = `('requested','locked','needs_new_time','standby')`;

function isJonsAddress(email: string): boolean {
  const e = email.trim().toLowerCase();
  return e === jonEmail().toLowerCase() || getEnv().ADMIN_EMAILS.includes(e);
}

export async function applyOutcome(
  db: Db,
  resendId: string,
  event: DeliveryEvent,
): Promise<'applied' | 'ignored'> {
  if (event === 'pending') return 'ignored';
  if (event === 'delivered') {
    const r = await db.query(
      `update email_log set delivery_final_at = now() where resend_id = $1 and delivery_final_at is null`,
      [resendId],
    );
    return r.rowCount ? 'applied' : 'ignored';
  }
  // A complaint can follow a delivery, so only the status (still 'sent') gates it.
  const { rows } = await db.query<{ to_email: string; request_id: string | null; template: TemplateId }>(
    `update email_log set status = $2, delivery_final_at = coalesce(delivery_final_at, now())
      where resend_id = $1 and status = 'sent'
      returning to_email::text as to_email, request_id, template`,
    [resendId, event],
  );
  const row = rows[0];
  if (!row) return 'ignored';
  if (JON_FACING.includes(row.template) || isJonsAddress(row.to_email)) {
    // Jon's own inbox: never suppress it (every admin email would stop), even when Jon tests as a guest
    // (pr34 L4). Tell the operator instead.
    reportMessage('Jon-facing email outcome', { area: 'email_outcome', event, template: row.template });
    return 'applied';
  }
  await db.query(`insert into email_suppression (email, reason) values ($1, $2) on conflict do nothing`, [
    row.to_email,
    event,
  ]);
  await db.query(
    `update email_log set status = 'suppressed'
      where to_email = $1 and status in ('pending', 'queued', 'failed')`,
    [row.to_email],
  );
  if (row.request_id) {
    await db.query(
      `update request set contact_problem = $2,
              awaiting_jon_since = case when status in ${OPEN_REQUEST}
                                        then coalesce(awaiting_jon_since, now()) else awaiting_jon_since end
        where id = $1`,
      [row.request_id, event],
    );
    await db.query(
      `insert into audit_log (actor, action, request_id, detail) values ('system', $1, $2, $3)`,
      [`email_${event}`, row.request_id, JSON.stringify({ template: row.template })],
    );
  }
  return 'applied';
}
