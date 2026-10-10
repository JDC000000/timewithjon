// src/features/email/status.ts — T3.2.07/.08 server side: the "Email limit reached" banner, the "budget hit
// two days running" health flag (read by /api/health, T3.14) and the failed-send list with its Resend action.
import 'server-only';
import { q } from '@/lib/db';
import { vancouverClock } from '@/lib/time';
import { currentMailerMode } from '@/lib/adapters/mailer';
import { GUARD_LIMITS, nextQueueOpen } from './guard';
import { deliverEmail, TERMINAL_RENDER_ERRORS, type DeliverResult } from './send';
import { STALE_ERROR } from './stale';

/**
 * pr58-verify N1/N2: only the NEWEST .ics (E4c) of a booking may be re-sent by hand. An older one is refused once any
 * newer E4c exists, in any state: one mid-send (the CANCEL claimed but not yet 'sent': a Resend racing it could land
 * the REQUEST after it) or one abandoned (resending the stale REQUEST would put the cancelled booking, or the old
 * time, back in the guest's calendar; the newer one is what Jon resends). SQL over the row aliased `l`. The tick's
 * claim keeps its own narrower rule (send.ts E4C_SUPERSEDED), so a live older row still goes out before the newer.
 */
const E4C_HAS_NEWER = `(l.template = 'E4c' and exists (
    select 1 from email_log n
     where n.template = 'E4c' and n.request_id = l.request_id and n.id <> l.id
       and (n.vars->>'sequence')::int > (l.vars->>'sequence')::int))`;

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export interface EmailLimit {
  reached: boolean;
  /** When today's waiting emails go out (00:05 UTC), as an instant and as Vancouver wall-clock time. */
  resumesAt: string | null;
  resumesAtLocal: string | null;
}
export async function emailLimit(now = new Date()): Promise<EmailLimit> {
  const rows = await q<{ hit: boolean }>(
    `select limit_hit_at is not null as hit from email_budget where utc_day = $1::date`,
    [utcDay(now)],
  );
  if (!rows[0]?.hit) return { reached: false, resumesAt: null, resumesAtLocal: null };
  const at = nextQueueOpen(now);
  return { reached: true, resumesAt: at.toISOString(), resumesAtLocal: vancouverClock(at) };
}

/** A day is "hit" when P2/P3 had to wait (the current mailer's budget) or the limit was reached. */
export async function budgetHitTwoDaysRunning(now = new Date()): Promise<boolean> {
  const rows = await q<{ day: string }>(
    `select utc_day::text as day from email_budget
      where utc_day between $1::date - 2 and $1::date and (sent_count >= $2 or limit_hit_at is not null)`,
    [utcDay(now), GUARD_LIMITS[await currentMailerMode()].budget],
  );
  const hit = new Set(rows.map((r) => r.day));
  const day = (back: number) => utcDay(new Date(now.getTime() - back * 86_400_000));
  return hit.has(day(1)) && (hit.has(day(0)) || hit.has(day(2)));
}

export interface FailedEmail {
  id: string;
  template: string;
  requestId: string | null;
  createdAt: string;
  lastError: string | null;
  /** false for a terminal render failure (pr31 review M3) or an E4c with a newer one (pr58 F1, N1/N2): refused. */
  resendable: boolean;
}
export async function failedEmails(limit = 50): Promise<FailedEmail[]> {
  return q<FailedEmail>(
    `select id, template, request_id as "requestId", created_at as "createdAt", last_error as "lastError",
            coalesce(last_error, '') <> all($2::text[]) and not ${E4C_HAS_NEWER} as resendable
       from email_log l where status = 'failed' and coalesce(last_error, '') <> $3
      order by created_at desc limit $1`,
    [limit, TERMINAL_RENDER_ERRORS, STALE_ERROR], // a stale email was dropped on purpose: nothing failed
  );
}

/**
 * T3.2.08: Jon's Resend. Only a 'failed' row can be re-sent; it gets a fresh set of attempts and goes out now
 * as P1 (AD-5 rule 1: the reserve up to 95 is for manual resends). Same email_log id = same idempotency key.
 * A render failure is terminal (pr31 review M3): it can't be re-sent, so it reads as not_found.
 * pr58 F1 + verify N1/N2: nor can an .ics (E4c) with a newer one for the same booking ('superseded'): a REQUEST
 * sent after its CANCEL would put the cancelled booking back in the guest's calendar. (deliverEmail's claim still
 * ends a row a newer SENT one replaced, e.g. one reset here just before its CANCEL was queued.)
 */
export async function resendFailedEmail(id: string): Promise<DeliverResult | 'not_found' | 'superseded'> {
  const rows = await q<{ id: string }>(
    `update email_log l set status = 'pending', attempts = 0, last_error = null,
            next_attempt_at = now() + interval '5 minutes'
      where id = $1 and status = 'failed' and coalesce(last_error, '') <> all($2::text[])
        and not ${E4C_HAS_NEWER} returning id`,
    [id, TERMINAL_RENDER_ERRORS],
  );
  if (!rows[0]) {
    const superseded = await q(
      `select 1 from email_log l where id = $1 and status = 'failed' and ${E4C_HAS_NEWER}`,
      [id],
    );
    return superseded.length ? 'superseded' : 'not_found';
  }
  return deliverEmail(id, { inline: true, priority: 1 });
}
