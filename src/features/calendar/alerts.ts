// src/features/calendar/alerts.ts — T3.14.02 (AD-6, R2): a dead Google grant is never silent. Any invalid_grant
// or 401 from Google (not invalid_client: a config error, see isGoogleConfigError), inline or in a job, and L4's
// 07:00 PT health check (T3.9.04) all go through ONE sender, sendE14Once (build-lanes ruling E14): it records the
// reason on oauth_connection.last_error (the admin banner reads it: googleBanner) and sends E14 to Jon, at most
// once per 6 h.
import 'server-only';
import { getEnv } from '@/config/env';
import { deliverEmail, jonEmail, queueEmail, type SendResult } from '@/features/email/send';
import { q, withTx } from '@/lib/db';
import { isGoogleAuthFailure, GoogleApiError } from '@/lib/adapters/google/http';
import { report, reportMessage } from '@/lib/report';

export const GOOGLE_ALERT_KEY = 'google_alert_sent_at';
export const GOOGLE_ALERT_EVERY_HOURS = 6;
const BUCKET_MS = GOOGLE_ALERT_EVERY_HOURS * 3_600_000;

/** E14's email_log event_key (TSD §6, R2-L2): 'google_auth:' + the start of the 6-hour UTC bucket. */
export function e14EventKey(now: Date = new Date()): string {
  return `google_auth:${new Date(Math.floor(now.getTime() / BUCKET_MS) * BUCKET_MS).toISOString()}`;
}

/**
 * THE E14 sender (pr41 F1/F2, pr42 F1). Serialised by an advisory lock; one E14 per rolling 6 h (the
 * google_alert_sent_at claim) and per 6-hour bucket (the permanent email_log unique key, which still holds if
 * system_status is lost). The claim is written in the SAME transaction as the queued email_log row, so only an
 * accepted send burns it: suppressed, capped or a throw (rolled back) leaves the next failure free to alert.
 * A queued row whose delivery fails stays 'failed' and the email retry job re-sends it.
 * Returns 'recent' when an E14 already went out in the last 6 h. May throw (DB); callers decide.
 */
export async function sendE14Once(reason: string, now: Date = new Date()): Promise<SendResult | 'recent'> {
  await q(`update oauth_connection set last_error = $1 where provider = 'google'`, [reason.slice(0, 80)]);
  const queued = await withTx(async (c) => {
    await c.query(`select pg_advisory_xact_lock(hashtext('twj_e14'))`);
    const recent = await c.query(
      `select 1 from system_status
        where key = $1 and updated_at > $2::timestamptz - make_interval(hours => $3)`,
      [GOOGLE_ALERT_KEY, now, GOOGLE_ALERT_EVERY_HOURS],
    );
    if (recent.rowCount) return 'recent' as const;
    const r = await queueEmail(c, {
      template: 'E14',
      to: jonEmail(),
      requestId: null,
      eventKey: e14EventKey(now),
      vars: { adminLink: `${getEnv().NEXT_PUBLIC_SITE_URL}/admin/settings` },
    });
    if (typeof r === 'string') return r;
    await c.query(
      `insert into system_status (key, value, updated_at) values ($1, $2, $3)
         on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
      [GOOGLE_ALERT_KEY, now.toISOString(), now],
    );
    return r;
  });
  if (queued === 'suppressed' || queued === 'capped') {
    reportMessage(`e14_not_sent:${queued}`, { area: 'google_alert' }); // Jon can't be told by email: Sentry must
  }
  return typeof queued === 'string' ? queued : deliverEmail(queued.queued, { inline: true, now });
}

/** An auth failure's reason code (never a message: those can carry PII). */
function authReason(e: unknown): string {
  return e instanceof GoogleApiError && e.reason ? e.reason : 'unauthorized';
}

/** Records the failure and sends E14 (sendE14Once). Never throws: the caller's error wins. */
export async function alertIfGoogleAuthFailure(e: unknown, now = new Date()): Promise<void> {
  if (!isGoogleAuthFailure(e)) return;
  try {
    await sendE14Once(authReason(e), now);
  } catch (err) {
    report(err, { area: 'google_alert' });
  }
}

/** Runs a Google call; on an auth failure, alerts (above) and rethrows the original error. */
export async function withGoogleAlert<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    await alertIfGoogleAuthFailure(e);
    throw e;
  }
}

/**
 * last_error codes that mean Jon must reconnect: Google's auth refusals (connection.ts stores `http_401` when a
 * refresh 401 has no reason) and the health check's 'revoked' (L4's 07:00 check passes that to sendE14Once).
 */
export const BROKEN_REASONS: ReadonlySet<string> = new Set([
  'invalid_grant',
  'unauthorized',
  'authError',
  'UNAUTHENTICATED',
  'http_401',
  'revoked',
]);

export type GoogleBanner = { problem: 'not_connected' } | { problem: 'broken'; reason: string } | null;

/**
 * Server data for the admin banner (the UI is T3.3.U1/after G1). No row = never connected (proto, pre-T3.3):
 * no banner, as there is nothing to fix yet. Only the reason code leaves: never the account or a token.
 */
export async function googleBanner(): Promise<GoogleBanner> {
  const [row] = await q<{ connected: boolean; last_error: string | null }>(
    `select refresh_token_enc is not null as connected, last_error from oauth_connection where provider = 'google'`,
  );
  if (!row) return null;
  if (!row.connected) return { problem: 'not_connected' };
  // pr41 F8: only a dead grant is 'broken'. A transient refresh failure (http_503, backendError) also lands in
  // last_error (connection.ts) but heals on its own, so it shows nothing.
  return row.last_error && BROKEN_REASONS.has(row.last_error)
    ? { problem: 'broken', reason: row.last_error }
    : null;
}
