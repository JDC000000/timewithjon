// src/features/email/bounce-poll.ts — T3.13.01 (b): polling mode, used when there is no webhook secret. The
// tick asks Resend about sent rows under 72 h old with no final word yet, least recently checked first, at
// most 30 calls a tick (T3.13 AC3). Prototype answers from the mock (Resend's test addresses).
// pr34 review: polling needs RESEND_READ_KEY (the send key is sending-only, M1); a 401/403 latches polling off
// with one report until the key changes; each call has a timeout inside the tick's budget (M2); calls are paced
// and a 429 ends the tick quietly (M3); rows are claimed so overlapping ticks never ask twice (L7).
import 'server-only';
import { createHash } from 'node:crypto';
import { getEnv } from '@/config/env';
import { MailerHttpError } from '@/lib/adapters/errors';
import { currentMailerMode } from '@/lib/adapters/mailer';
import { mockDeliveryStatus } from '@/lib/adapters/mock/delivery-status';
import { createResendStatusSource, type DeliveryStatusSource } from '@/lib/adapters/resend/status';
import { q, withTx } from '@/lib/db';
import { report, reportMessage } from '@/lib/report';
import { applyOutcome } from './outcome';

export const MAX_CALLS_PER_TICK = 30;
/** pr42-verify N1: a row asked in the last 5 minutes (by this or an overlapping tick) isn't asked again yet. */
export const RECHECK_AFTER_MIN = 5;
/** Per GET; also capped by what is left of the tick's budget. */
export const CALL_TIMEOUT_MS = 3000;
export const POLL_DISABLED_KEY = 'bounce_poll_disabled';

interface PollLatch {
  status: number;
  at: string;
  key: string;
}

/** Which read key the latch belongs to: a 12-hex fingerprint, never the key. A new key clears the latch. */
function readKeyId(): string {
  const key = getEnv().RESEND_READ_KEY;
  return key ? createHash('sha256').update(key).digest('hex').slice(0, 12) : 'none';
}

async function readLatch(): Promise<PollLatch | null> {
  const [row] = await q<{ value: string | null }>('select value from system_status where key = $1', [
    POLL_DISABLED_KEY,
  ]);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as PollLatch;
  } catch {
    return null;
  }
}

/** For the admin email status (GET /api/admin/email): polling is off because Resend refused the read key. */
export async function bouncePollStatus(): Promise<
  { disabled: false } | { disabled: true; status: number; since: string }
> {
  const latch = await readLatch();
  if (!latch || latch.key !== readKeyId()) return { disabled: false };
  return { disabled: true, status: latch.status, since: latch.at };
}

/** null = no polling here: the webhook is on, this environment doesn't send through Resend, or it's latched off. */
export async function pollingSource(): Promise<DeliveryStatusSource | null> {
  const env = getEnv();
  if (env.RESEND_WEBHOOK_SECRET) return null;
  let source: DeliveryStatusSource;
  if (env.APP_MODE === 'prototype') source = mockDeliveryStatus;
  else if ((await currentMailerMode()) === 'resend' && env.RESEND_READ_KEY)
    source = createResendStatusSource(env.RESEND_READ_KEY);
  else return null;
  const latch = await readLatch();
  if (latch) {
    if (latch.key === readKeyId()) return null;
    await q('delete from system_status where key = $1', [POLL_DISABLED_KEY]); // the key was changed: try again
  }
  return source;
}

/** Resend refused the key (401/403): polling stays off until the key changes. Reported once per key. */
async function latchOff(status: number): Promise<void> {
  const value = JSON.stringify({
    status,
    at: new Date().toISOString(),
    key: readKeyId(),
  } satisfies PollLatch);
  const written = await q(
    `insert into system_status (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()
       where (system_status.value::jsonb ->> 'key') is distinct from (excluded.value::jsonb ->> 'key')
     returning key`,
    [POLL_DISABLED_KEY, value],
  );
  if (written.length)
    reportMessage('Bounce polling disabled: Resend refused the read key', {
      area: 'bounce_poll',
      status: String(status),
    });
}

const isTimeout = (e: unknown) =>
  e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function pollDeliveryOutcomes(
  source: DeliveryStatusSource,
  deadline: number,
  max = MAX_CALLS_PER_TICK,
): Promise<number> {
  const spacingMs = source.spacingMs ?? 0;
  // Claimed up front (checked = now), so an overlapping tick skips these rows; asked in the old order.
  // The claim is serialised (an advisory lock, then the claim in a fresh statement of the same transaction): with
  // SKIP LOCKED alone, a claim whose snapshot predates another's commit re-checked those rows after the commit and
  // took them again (a real double ask, seen on PG15 CI). After the lock, the claim sees the other's checked_at.
  const rows = await withTx(async (c) => {
    await c.query(`select pg_advisory_xact_lock(hashtext('twj_bounce_poll_claim'))`);
    const claimed = await c.query<{ id: string; resend_id: string; to_email: string }>(
      `with pick as (
       select id, delivery_checked_at as prev, created_at from email_log
        where status = 'sent' and delivery_final_at is null and resend_id is not null
          and created_at > now() - interval '72 hours'
          and (delivery_checked_at is null or delivery_checked_at < now() - interval '${RECHECK_AFTER_MIN} minutes')
        order by delivery_checked_at nulls first, created_at
        limit $1 for update skip locked
     ), claimed as (
       update email_log e set delivery_checked_at = now() from pick where e.id = pick.id
       returning e.id, e.resend_id, e.to_email::text as to_email, pick.prev, pick.created_at
     )
     select id, resend_id, to_email from claimed order by prev nulls first, created_at`,
      [Math.min(max, MAX_CALLS_PER_TICK)],
    );
    return claimed.rows;
  });
  let calls = 0;
  for (const r of rows) {
    if (calls > 0 && spacingMs > 0) {
      if (Date.now() + spacingMs >= deadline) break;
      await sleep(spacingMs);
    }
    const timeoutMs = Math.min(CALL_TIMEOUT_MS, deadline - Date.now());
    if (timeoutMs <= 0) break;
    calls++;
    let event;
    try {
      event = await source.status(r.resend_id, r.to_email, timeoutMs);
    } catch (e) {
      if (e instanceof MailerHttpError && (e.status === 401 || e.status === 403)) await latchOff(e.status);
      else if (!(e instanceof MailerHttpError && e.status === 429) && !isTimeout(e))
        report(e, { area: 'bounce_poll' });
      break; // refused, rate-limited, slow or down: stop until the next tick
    }
    await withTx((c) => applyOutcome(c, r.resend_id, event));
  }
  return calls;
}
