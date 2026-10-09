// src/features/email/digest.ts — T3.2.06: the hourly "What's new" digest (AD-5 rule 3). Past 60 sends a day,
// P3 (Jon-facing) emails are parked for the top of the next UTC hour; the tick collapses the due ones into ONE
// E13 to Jon (event_key 'hour:' + the ISO hour; the daily E13 keeps the Vancouver date). Each line is the
// parked email's subject only, never a body: no note, plan, story or phone can reach it (T3.2 AC4).
import 'server-only';
import { getEnv } from '@/config/env';
import type { TemplateId } from '@/content/emails';
import { pool } from '@/lib/db';
import { digestEventKey } from './guard';
import { renderText } from './registry';
import { deliverEmail, jonEmail, queueEmail, type DeliverResult } from './send';

export function digestLine(template: TemplateId, vars: Record<string, string | number>): string {
  try {
    return renderText(template, vars).subject;
  } catch {
    return template; // a row that can't render still shows up, by its template name
  }
}

/**
 * QA4b M2: one digest entry per parked email, "- {subject}", and under it, indented on its own line, the page it
 * opened (E2, E3, E12, E16's admin link) so Jon can still go straight to that request. The HTML part links the
 * subject itself (E13.tsx).
 */
export function digestEntry(template: TemplateId, vars: Record<string, string | number>): string {
  const link = typeof vars.adminLink === 'string' && vars.adminLink ? `\n  ${vars.adminLink}` : '';
  return `- ${digestLine(template, vars)}${link}`;
}

export async function sendHourlyDigest(now: Date): Promise<DeliverResult | 'none'> {
  const c = await pool().connect();
  let digestId: string;
  try {
    await c.query('begin');
    const { rows } = await c.query<{ template: TemplateId; vars: Record<string, string | number> }>(
      `with due as (
         update email_queue set sent_at = now()
          where kind = 'digest' and sent_at is null and not_before <= $1
          returning email_log_id
       ), folded as (
         update email_log l set status = 'digested' from due
          where l.id = due.email_log_id and l.status = 'queued'
          returning l.template, l.vars, l.created_at
       )
       select template, vars from folded order by created_at`,
      [now],
    );
    if (rows.length === 0) {
      await c.query('rollback');
      return 'none';
    }
    const queued = await queueEmail(c, {
      template: 'E13',
      to: jonEmail(),
      requestId: null,
      eventKey: digestEventKey(now),
      vars: {
        digest: 'hourly', // EML-10: its own subject (copyFor); the lines are emails, not stories
        count: rows.length,
        lines: rows.map((r) => digestEntry(r.template, r.vars)).join('\n'),
        adminLink: `${getEnv().NEXT_PUBLIC_SITE_URL}/admin`,
      },
    });
    if (typeof queued === 'string') {
      await c.query('rollback'); // this hour's digest already exists: the rows wait for the next hour
      return 'none';
    }
    await c.query('commit');
    digestId = queued.queued;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
  return deliverEmail(digestId, { inline: true, now });
}
