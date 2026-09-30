// src/features/email/send.ts — the one idempotent send path (C5, §6 email_log, L-3).
// 1. queueEmail() runs INSIDE the transaction: it writes a 'pending' email_log row (unique on template +
//    request + event_key), after the suppression list and the E1 per-recipient cap.
// 2. After commit, deliverEmail() / deliverRequestEmails() send it, awaited.
// 3. The tick job 'email-retry' re-sends rows still 'pending' (a crash after commit) or 'failed' (a mailer
//    error) at +5/+15/+30 min. The email_log id is the provider idempotency key, so a retry can't double-send
//    within the provider's window.
// 4. T3.2.05: every send renders first (a render that can't succeed is terminal), then takes a slot under its
//    class's AD-5 ceiling (guard.ts). A refused slot parks the row in email_queue for 00:05 UTC (queue.ts) or
//    for the next hourly digest (digest.ts); a parked row is 'queued' and its attempt is given back. A Resend
//    quota 429 is never retried: the row waits for tomorrow.
// Prototype sends go to dev_outbox via the mock.
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { getEnv } from '@/config/env';
import type { TemplateId } from '@/content/emails';
import { emailAttachments } from '@/features/calendar/ics-attachment';
import { adapters } from '@/lib/adapters';
import {
  MailerHttpError,
  MailerInvalidMessageError,
  MailerNotConfiguredError,
  MailerQuotaError,
} from '@/lib/adapters/errors';
import type { OutgoingEmail } from '@/lib/adapters/types';
import { pool, q } from '@/lib/db';
import { currentMailerMode } from '@/lib/adapters/mailer';
import { errorName, report } from '@/lib/report';
import { markLimitHit, releaseSlot, takeAppSlot } from './budget';
import {
  ceilingFor,
  decide,
  GUARD_LIMITS,
  isHourlyDigest,
  nextHour,
  nextQueueOpen,
  PRIORITY,
  type AppPriority,
  type GuardDecision,
} from './guard';
import { flattenHeader } from './headers';
import { resolveLinkVars, type EmailVar } from './link-vars';
import { renderEmail, type Rendered } from './registry';

export const E1_DAILY_CAP = 3;
export const MAX_ATTEMPTS = 4;
export type QueueResult = { queued: string } | 'duplicate' | 'suppressed' | 'capped';
export type DeliverResult = 'sent' | 'failed' | 'skipped' | 'queued' | 'digested';
export type SendResult = DeliverResult | 'duplicate' | 'suppressed' | 'capped';

export interface DeliverOptions {
  inline: boolean;
  now?: Date;
  /** Overrides the template's class: a manual Resend is P1 (AD-5 rule 1), a queued row keeps its class. */
  priority?: AppPriority;
}

export interface EmailArgs {
  template: TemplateId;
  to: string;
  requestId: string | null;
  eventKey: string;
  vars: Record<string, EmailVar>; // a link var is a LinkSpec, minted at send time (link-vars.ts)
}

type Db = Pool | PoolClient;

/** Jon's Gmail: Reply-To on every email (v1.4) and the To for Jon-facing templates. */
export function jonEmail(): string {
  const env = getEnv();
  return env.JON_PERSONAL_EMAIL ?? env.ADMIN_EMAILS[0]!;
}

/** Step 1: call inside the transaction that makes the state change. */
export async function queueEmail(db: Db, a: EmailArgs): Promise<QueueResult> {
  const suppressed = await db.query(`select 1 from email_suppression where email = $1`, [a.to]);
  if (suppressed.rowCount) return 'suppressed';
  if (a.template === 'E1') {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from email_log where template = 'E1' and to_email = $1 and created_at > now() - interval '1 day'`,
      [a.to],
    );
    if ((rows[0]?.n ?? 0) >= E1_DAILY_CAP) return 'capped';
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into email_log (template, to_email, request_id, event_key, status, vars) values ($1,$2,$3,$4,'pending',$5)
     on conflict on constraint email_log_idem do nothing returning id`,
    [a.template, a.to, a.requestId, a.eventKey, JSON.stringify(a.vars)],
  );
  return rows[0] ? { queued: rows[0].id } : 'duplicate';
}

/**
 * Step 2/3: claim one attempt atomically, then send. `inline` = the request that queued it, which may claim
 * a never-tried row at once; otherwise (the tick) only rows whose next_attempt_at has passed are claimed.
 */
/**
 * pr54 F6: a booking's .ics emails (E4c) go out in SEQUENCE order: a REQUEST that reaches the guest after its CANCEL
 * would put a cancelled booking back in some calendars. SQL over the row aliased `l`; `now` is the caller's
 * timestamptz parameter (NULL = the DB clock).
 * WAITS: an older E4c for the same request is still unsent and may still go: pending/failed with tries left,
 * parked for 00:05 UTC ('queued'), or on its last try right now (pr58 F2: that claim already set attempts to 4, so
 * its lease, next_attempt_at, counts too). An abandoned older one stops blocking once its last lease runs out.
 */
const e4cWaits = (now: string) => `(l.template = 'E4c' and exists (
    select 1 from email_log o
     where o.template = 'E4c' and o.request_id = l.request_id and o.id <> l.id
       and (o.vars->>'sequence')::int < (l.vars->>'sequence')::int
       and o.status in ('pending', 'failed', 'queued')
       and (o.attempts < ${MAX_ATTEMPTS} or o.next_attempt_at > coalesce(${now}::timestamptz, now()))))`;
/**
 * pr58 F1: SUPERSEDED: a newer E4c for the same request already went out, so the claim never sends this one. A
 * newer one that never reached the guest (suppressed, failed) doesn't count here, so the tick still sends a live
 * older row first; Jon's Resend refuses any E4c with a newer one (status.ts E4C_HAS_NEWER).
 */
const E4C_SUPERSEDED = `(l.template = 'E4c' and exists (
    select 1 from email_log n
     where n.template = 'E4c' and n.request_id = l.request_id and n.id <> l.id
       and (n.vars->>'sequence')::int > (l.vars->>'sequence')::int
       and n.status in ('sent', 'delayed', 'bounced', 'complained')))`;
export const SUPERSEDED_ERROR = 'superseded';

export async function deliverEmail(id: string, opts: DeliverOptions): Promise<DeliverResult> {
  const [row] = await q<{
    template: TemplateId;
    to_email: string;
    vars: Record<string, unknown>;
    event_key: string | null;
    created_at: Date;
  }>(
    `update email_log l
        set attempts = attempts + 1,
            next_attempt_at = coalesce($3, now()) + case attempts when 0 then interval '5 minutes'
                                                               when 1 then interval '15 minutes'
                                                               else interval '30 minutes' end
      where id = $1 and status in ('pending', 'failed') and attempts < ${MAX_ATTEMPTS}
        and ((attempts = 0 and $2) or next_attempt_at <= coalesce($3, now()))
        and not ${e4cWaits('$3')} and not ${E4C_SUPERSEDED}
      returning template, to_email::text as to_email, vars, event_key, created_at`,
    [id, opts.inline, opts.now ?? null],
  );
  if (!row) {
    // pr58 F1: a newer E4c already reached the guest, so this one is terminal (no retry, no Resend).
    const superseded = await q(
      `update email_log l set status = 'failed', attempts = ${MAX_ATTEMPTS}, last_error = '${SUPERSEDED_ERROR}'
        where id = $1 and status in ('pending', 'failed') and ${E4C_SUPERSEDED} returning id`,
      [id],
    );
    if (superseded.length) return 'failed';
    // pr54 F6: an E4c that must wait for an older one isn't claimed (no attempt burned); it moves a minute on, so
    // this tick's retry batches don't pick it again, and a later tick sends it once the older one is out.
    // pr58 F6: never earlier than it already was (a backoff isn't shortened).
    await q(
      `update email_log l set next_attempt_at = greatest(next_attempt_at, coalesce($2, now()) + interval '1 minute')
        where id = $1 and status in ('pending', 'failed') and ${e4cWaits('$2')}`,
      [id, opts.now ?? null],
    );
    return 'skipped'; // already sent, being sent, not due, out of attempts, or waiting its turn (E4c)
  }
  const now = opts.now ?? new Date();
  const priority = opts.priority ?? PRIORITY[row.template];
  // pr31 review M3: render BEFORE taking a slot. A render that can never succeed is terminal (no slot, no retry).
  let r: Rendered;
  let attachments: OutgoingEmail['attachments'];
  try {
    // Action-token links are minted now, from the row's link specs (never a raw token in email_log). The token is
    // deterministic per row (pr40 H1), so a retry renders the same body. A DB error here stays retryable.
    const vars = await resolveLinkVars(id, row.vars, opts.now);
    r = await renderEmail(row.template, vars);
    // AD-6: E4c carries the .ics, built from the row alone (stamped with its created_at), so a retry is identical.
    attachments = emailAttachments(row.template, vars, row.to_email, row.created_at);
  } catch (e) {
    return failRender(id, row.template, e);
  }
  const slot = await guardSlot(priority, !isHourlyDigest(row.template, row.event_key));
  if ('park' in slot) {
    // A P1 that must wait marks the day full, so the banner shows (unless it's already marked).
    if (slot.park === 'queue' && priority === 1 && !slot.limitHit && slot.day) await markLimitHit(slot.day);
    await parkEmail(id, slot.park, priority, now);
    return slot.park === 'queue' ? 'queued' : 'digested';
  }
  // pr34 L5: a bounce may have suppressed this address (and this row) since the claim. Last look before sending.
  const stillOpen = await q(
    `select 1 from email_log l where l.id = $1 and l.status <> 'suppressed'
        and not exists (select 1 from email_suppression s where s.email = l.to_email)`,
    [id],
  );
  if (!stillOpen.length) {
    await releaseSlot('app', slot.day);
    await q(`update email_log set status = 'suppressed' where id = $1`, [id]);
    return 'skipped';
  }
  const env = getEnv();
  try {
    const { id: providerId } = await adapters().mailer.send({
      template: row.template,
      to: row.to_email,
      subject: flattenHeader(r.subject), // defence in depth: never a header break (M5, V1)
      text: r.text,
      html: r.html,
      idempotencyKey: id,
      from:
        r.fromLocal === 'jon'
          ? (env.EMAIL_FROM_GUEST ?? 'Jon <jon@timewithjon.com>')
          : (env.EMAIL_FROM_ADMIN ?? 'Time with Jon <admin@timewithjon.com>'),
      replyTo: jonEmail(),
      ...(attachments ? { attachments } : {}),
    });
    // A suppression that lands during the send keeps its status; the provider id is still recorded.
    await q(
      `update email_log set status = case when status = 'suppressed' then status else 'sent' end,
              resend_id = $2, last_error = null
        where id = $1`,
      [id, providerId],
    );
    return 'sent';
  } catch (e) {
    if (e instanceof MailerQuotaError) {
      // AD-5 rule 6: Resend says the day (or month) is used up. The day counts as full; nothing is retried.
      await releaseSlot('app', slot.day, true);
      await parkEmail(id, 'queue', priority, now);
      return 'queued';
    }
    if (isDefiniteNonSend(e)) await releaseSlot('app', slot.day);
    // pr36 F3/F8: a mailer that can't be used, or a message that can't be built, fails the same way every time:
    // failed for good on the first try (one report, no burnt retries). A config error stays resendable once fixed.
    const permanent = e instanceof MailerNotConfiguredError || e instanceof MailerInvalidMessageError;
    await q(
      `update email_log set status = 'failed', last_error = $2${permanent ? `, attempts = ${MAX_ATTEMPTS}` : ''}
        where id = $1`,
      [id, errorName(e).slice(0, 200)],
    );
    report(e, { area: 'email', template: row.template });
    return 'failed';
  }
}

/**
 * Error names that make a render permanently impossible (pr31 review M3; the link-spec failure joins this list
 * with L3's resolveLinkVars: UnknownLinkKindError; an E4c that can't make its .ics: IcsRenderError), plus a message
 * the mailer can never build (pr36 F8). Such a row is failed for good: no retry, and Resend refuses it.
 */
export const TERMINAL_RENDER_ERRORS: readonly string[] = [
  'UnfilledPlaceholderError',
  'UnknownLinkKindError',
  'MailerInvalidMessageError',
  'IcsRenderError',
];

async function failRender(id: string, template: TemplateId, e: unknown): Promise<'failed'> {
  const name = errorName(e).slice(0, 200);
  const terminal = TERMINAL_RENDER_ERRORS.includes(name);
  await q(
    `update email_log set status = 'failed', last_error = $2${terminal ? `, attempts = ${MAX_ATTEMPTS}` : ''}
      where id = $1`,
    [id, name],
  );
  report(e, { area: 'email', template });
  return 'failed';
}

/**
 * A send that certainly never went out gives its slot back: an unusable mailer, or a 4xx refusal. Not a 409
 * (an idempotent replay of a send that may have gone out: pr31 review L2) and not a 5xx or network error.
 */
function isDefiniteNonSend(e: unknown): boolean {
  if (e instanceof MailerNotConfiguredError || e instanceof MailerInvalidMessageError) return true;
  return e instanceof MailerHttpError && e.status < 500 && e.status !== 409;
}

type GuardedSlot = { day: string } | { park: Exclude<GuardDecision, 'send'>; day: string; limitHit: boolean };

/**
 * pr31 review M1: takes a slot only under this class's ceiling (one atomic upsert); a refusal takes nothing
 * and says where the email waits. If the count dropped between the refusal and the read (a slot given back),
 * it tries again.
 */
async function guardSlot(priority: AppPriority, digestable: boolean): Promise<GuardedSlot> {
  const limits = GUARD_LIMITS[await currentMailerMode()]; // pr36 F5: the thresholds of the mailer that sends
  for (let i = 0; i < 3; i++) {
    const s = await takeAppSlot(ceilingFor(priority, digestable, limits));
    if (s.taken) return { day: s.day };
    const park = s.limitHit ? 'queue' : decide(s.count, priority, digestable, limits);
    if (park !== 'send') return { park, day: s.day, limitHit: s.limitHit };
  }
  return { park: priority === 3 && digestable ? 'digest' : 'queue', day: '', limitHit: false };
}

/**
 * Parks a claimed row: 'queued' in email_log (its claimed attempt given back) plus one email_queue row, which a
 * re-park updates in place (email_log_id is unique there).
 */
async function parkEmail(
  id: string,
  decision: Exclude<GuardDecision, 'send'>,
  priority: AppPriority,
  now: Date,
): Promise<void> {
  const [kind, notBefore] =
    decision === 'queue' ? ['next_day', nextQueueOpen(now)] : ['digest', nextHour(now)];
  await q(
    `with parked as (
       update email_log set status = 'queued', attempts = attempts - 1 where id = $1 returning id
     )
     insert into email_queue (email_log_id, priority, not_before, kind) select id, $2, $3, $4 from parked
     on conflict (email_log_id) do update
       set priority = excluded.priority, not_before = excluded.not_before, kind = excluded.kind, sent_at = null`,
    [id, priority, notBefore, kind],
  );
}

/** After commit (and on an idempotent replay): send every never-tried email for this request. */
export async function deliverRequestEmails(requestId: string): Promise<DeliverResult[]> {
  const rows = await q<{ id: string }>(
    `select id from email_log where request_id = $1 and status = 'pending' and attempts = 0 order by created_at, template`,
    [requestId],
  );
  const out: DeliverResult[] = [];
  for (const r of rows) out.push(await deliverEmail(r.id, { inline: true }));
  return out;
}

/**
 * Tick job body: re-send due 'pending'/'failed' rows, oldest first, in batches until none are due or the tick
 * budget runs out (a backlog must not starve newer rows). Each claim pushes next_attempt_at past `now`, so a row
 * is tried at most once per tick; `maxBatches` is only a guard.
 */
export async function retryDueEmails(
  now: Date,
  deadline: number,
  batch = 20,
  maxBatches = 10,
): Promise<number> {
  let sent = 0;
  for (let i = 0; i < maxBatches && Date.now() < deadline; i++) {
    const due = await q<{ id: string }>(
      `select id from email_log where status in ('pending', 'failed') and attempts < ${MAX_ATTEMPTS}
          and next_attempt_at <= $1 order by next_attempt_at limit $2`,
      [now, batch],
    );
    if (due.length === 0) break;
    for (const r of due) {
      if (Date.now() > deadline) return sent;
      if ((await deliverEmail(r.id, { inline: false, now })) === 'sent') sent++;
    }
  }
  return sent;
}

/** Outside a transaction (single-step callers): queue, then deliver at once. */
export async function sendTemplate(a: EmailArgs): Promise<SendResult> {
  const queued = await queueEmail(pool(), a);
  return typeof queued === 'string' ? queued : deliverEmail(queued.queued, { inline: true });
}
