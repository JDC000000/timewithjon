// src/features/jobs/health.ts — T3.14.01 (TSD T3.14, H4): the checks behind GET /api/health, the URL UptimeRobot
// watches (T3.14.03). Any failing check = 503. The body names checks and reason codes only: never an address,
// a token, a request id or an error message (AGENTS.md rule 6).
// Three things are WARNINGS (named lines, still 200): the email budget hit two days running (T3.2.07), emails the
// retry job gave up on (review V3) and media outbox items out of tries (pr61 F2). They stay failed until someone
// acts, so a 503 would hold the monitor down for days; the admin lists are where they're acted on.
// A public, unauthenticated URL: the route serves cachedHealthReport, so a flood costs one check per 15 s (pr61 F6).
// Outside the prototype, a demo invite from supabase/seed.sql (its secret is public) fails `seed_invites`.
// T3.14.01: a tick where every job threw fails `tick` as 'jobs_failing' (the heartbeat alone stayed ok); a tick where
// some threw is a warning. The public body says only ok/fail per check (publicHealthBody); the reason codes and
// warnings are served only with the cron secret.
import 'server-only';
import { getEnv, type AppMode } from '@/config/env';
import { SIGNIN_FAILED_KEY } from '@/features/admin/signin';
import { BROKEN_REASONS } from '@/features/calendar/alerts';
import { OUTBOX_MAX_ATTEMPTS } from '@/features/calendar/outbox';
import { MAX_ATTEMPTS as EMAIL_MAX_ATTEMPTS } from '@/features/email/send';
import { STALE_ERROR } from '@/features/email/stale';
import { budgetHitTwoDaysRunning } from '@/features/email/status';
import { SeedInvitePresent, seedSecretsToCheck } from '@/features/invites/seed-invites';
import { q } from '@/lib/db';
import { report } from '@/lib/report';
import { MEDIA_MAX_ATTEMPTS } from './media-limits';
import { TICK_FAILED_KEY } from './registry';

const MIN = 60_000;
/** TSD T3.14 thresholds. The tick runs every 15 min, the media job every 5, the token check once a day. */
export const HEALTH_LIMITS = {
  tickMs: 35 * MIN,
  outboxOverdueMs: 60 * MIN,
  googleOkMs: 26 * 60 * MIN,
  mediaMs: 20 * MIN,
  signinEmailMs: 24 * 60 * MIN,
} as const;

export type CheckName = 'database' | 'tick' | 'outbox' | 'google' | 'media' | 'signin_email' | 'seed_invites';
export interface HealthReport {
  ok: boolean;
  /** Each check's state: 'ok', 'skipped' (google before T3.3), or a short reason code. */
  checks: Record<CheckName, string>;
  failing: CheckName[];
  warnings: string[];
}

/** pr61 F2: "1 item given up" / "2 items given up" (media outbox rows out of tries). */
export function givenUpLine(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'} given up`;
}

/** "1 email not delivered" / "3 emails not delivered" (tasks.md T3.14.01 AC, review V3). */
export function notDeliveredLine(count: number): string {
  return `${count} ${count === 1 ? 'email' : 'emails'} not delivered`;
}

interface Row {
  tick_at: Date | null;
  tick_failed: string | null;
  media_at: Date | null;
  signin_at: Date | null;
  signin_reason: string | null;
  oldest_due: Date | null;
  has_google: boolean;
  google_connected: boolean;
  google_ok_at: Date | null;
  google_error: string | null;
  abandoned_emails: number;
  media_given_up: number;
  seed_invites: boolean;
}

/** A heartbeat older than `limitMs`, or never written, fails. */
const heartbeat = (at: Date | null, now: Date, limitMs: number): string =>
  !at ? 'missing' : now.getTime() - at.getTime() < limitMs ? 'ok' : 'stale';

/** The last tick's "failed/attempted" (registry.ts); null when unknown or unreadable. */
export function parseTickFailed(value: string | null): { failed: number; attempted: number } | null {
  const m = /^(\d+)\/(\d+)$/.exec(value ?? '');
  return m ? { failed: Number(m[1]), attempted: Number(m[2]) } : null;
}

/** How many jobs must have run (and all failed) before the tick check is red. */
export const MIN_JOBS_FOR_FAILING = 2;

function tickCheck(r: Row, now: Date): string {
  const beat = heartbeat(r.tick_at, now, HEALTH_LIMITS.tickMs);
  if (beat !== 'ok') return beat;
  const t = parseTickFailed(r.tick_failed);
  // Every job failed, and more than one ran: one job that hit the hard stop and skipped the rest ("1/1") is a
  // warning, not a red health check (it would page the uptime monitor for a quarter of an hour).
  return t && t.attempted >= MIN_JOBS_FOR_FAILING && t.failed === t.attempted ? 'jobs_failing' : 'ok';
}

function googleCheck(r: Row, now: Date): string {
  if (!r.has_google) return 'skipped'; // R2-L6: production between T3.1 and T3.3 (AC5)
  // pr61 F1: a Disconnect or a refused reconnect keeps the row with no token (connection.ts): calendar writes fail.
  if (!r.google_connected) return 'disconnected';
  if (r.google_error && BROKEN_REASONS.has(r.google_error)) return 'broken'; // the admin banner's state (alerts.ts)
  return heartbeat(r.google_ok_at, now, HEALTH_LIMITS.googleOkMs);
}

export async function healthReport(
  now = new Date(),
  mode: AppMode = getEnv().APP_MODE,
): Promise<HealthReport> {
  const seedSecrets = seedSecretsToCheck(mode);
  let row: Row;
  try {
    // One query (plus the budget warning's). "Due" mirrors exactly what the processors take (pr61 F3): calendar
    // rows with a request (outbox.ts; a spam Delete nulls it) and tries left; media rows with tries left (media.ts).
    // Nothing processes kind 'ics', and a row out of tries is never taken again, so neither can pin a 503.
    // (The calendar kinds by prefix: this file never names the delete kind, see ics-cancel-static.test.ts.)
    [row] = (await q<Row>(
      `select (select updated_at from system_status where key = 'last_tick_at') as tick_at,
              (select value from system_status where key = $7) as tick_failed,
              (select updated_at from system_status where key = 'last_media_run_at') as media_at,
              (select updated_at from system_status where key = $2) as signin_at,
              (select value from system_status where key = $2) as signin_reason,
              (select min(next_attempt_at) from outbox
                where done_at is null and next_attempt_at <= $1
                  and ((left(kind::text, 9) = 'calendar_'
                        and request_id is not null and attempts < $4::int)
                    or (kind in ('r2_copy', 'attachment_finalise') and attempts < $3::int))
              ) as oldest_due,
              (select count(*)::int from outbox
                where done_at is null and kind in ('r2_copy', 'attachment_finalise') and attempts >= $3::int
              ) as media_given_up,
              exists (select 1 from oauth_connection where provider = 'google') as has_google,
              exists (select 1 from oauth_connection
                       where provider = 'google' and refresh_token_enc is not null) as google_connected,
              (select last_ok_at from oauth_connection where provider = 'google') as google_ok_at,
              (select last_error from oauth_connection where provider = 'google') as google_error,
              (select count(*)::int from email_log
                where status = 'failed' and attempts >= $5 and coalesce(last_error, '') <> '${STALE_ERROR}') as abandoned_emails,
              exists (select 1 from invite where token_secret = any($6::text[])) as seed_invites`,
      [
        now,
        SIGNIN_FAILED_KEY,
        MEDIA_MAX_ATTEMPTS,
        OUTBOX_MAX_ATTEMPTS,
        EMAIL_MAX_ATTEMPTS,
        seedSecrets,
        TICK_FAILED_KEY,
      ],
    )) as [Row];
  } catch (e) {
    report(e, { area: 'health' }); // pr61 F4: a SQL bug must not pass for a Supabase outage (the class name only)
    return {
      ok: false,
      checks: {
        database: 'down',
        tick: 'unknown',
        outbox: 'unknown',
        google: 'unknown',
        media: 'unknown',
        signin_email: 'unknown',
        seed_invites: 'unknown',
      },
      failing: ['database'],
      warnings: [],
    };
  }
  const signinFresh = row.signin_at && now.getTime() - row.signin_at.getTime() < HEALTH_LIMITS.signinEmailMs;
  const checks: Record<CheckName, string> = {
    database: 'ok',
    tick: tickCheck(row, now),
    outbox:
      row.oldest_due && now.getTime() - row.oldest_due.getTime() >= HEALTH_LIMITS.outboxOverdueMs
        ? 'overdue'
        : 'ok',
    google: googleCheck(row, now),
    media: heartbeat(row.media_at, now, HEALTH_LIMITS.mediaMs),
    // The reason code only (smtp, quota or capped: signin.ts), never the address.
    signin_email: signinFresh ? (row.signin_reason ?? 'failed') : 'ok',
    seed_invites: mode === 'prototype' ? 'skipped' : row.seed_invites ? 'present' : 'ok',
  };
  if (checks.seed_invites === 'present')
    report(new SeedInvitePresent(), { area: 'health', check: 'seed_invites' });
  const failing = (Object.keys(checks) as CheckName[]).filter((k) => !['ok', 'skipped'].includes(checks[k]));

  const warnings: string[] = [];
  // A warning's own query failing must not turn a healthy system red: it's reported as a line instead.
  const budgetHit = await budgetHitTwoDaysRunning(now).catch(() => null);
  if (budgetHit === null) warnings.push('email_budget: unknown');
  else if (budgetHit) warnings.push('email_budget: limit hit 2 days running');
  if (row.abandoned_emails > 0) warnings.push(`failed_emails: ${notDeliveredLine(row.abandoned_emails)}`);
  if (row.media_given_up > 0) warnings.push(`outbox: ${givenUpLine(row.media_given_up)}`);
  const tickFailed = parseTickFailed(row.tick_failed);
  if (checks.tick === 'ok' && tickFailed && tickFailed.failed > 0)
    warnings.push(`tick: ${tickFailed.failed} of ${tickFailed.attempted} jobs failed`);

  return { ok: failing.length === 0, checks, failing, warnings };
}

export interface PublicHealthBody {
  ok: boolean;
}

/** What anyone may see: up or not (the 200/503 says the same). Which check failed, and why, needs the cron secret. */
export function publicHealthBody(r: HealthReport): PublicHealthBody {
  return { ok: r.ok };
}

export const HEALTH_CACHE_MS = 15_000;
let cached: { at: number; report: HealthReport } | null = null;

/** pr61 F6: the route's entry point: one real check per 15 s per instance (the response itself stays no-store). */
export async function cachedHealthReport(now = new Date()): Promise<HealthReport> {
  const age = cached ? now.getTime() - cached.at : Infinity;
  if (cached && age >= 0 && age < HEALTH_CACHE_MS) return cached.report;
  const fresh = await healthReport(now);
  cached = { at: now.getTime(), report: fresh };
  return fresh;
}

export function resetHealthCacheForTests(): void {
  cached = null;
}
