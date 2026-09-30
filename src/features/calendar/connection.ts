// src/features/calendar/connection.ts — T3.3.03–.05 (AD-6): Jon's Google connection, one oauth_connection row.
// Connect: state + PKCE → Google consent → callback checks the account and the exact G3 scope set, creates
// "Time with Jon" only if no calendar is stored, and stores the refresh token encrypted (crypto.ts).
// Disconnect revokes the grant and clears the token but keeps calendar_id, so a reconnect reuses the calendar.
import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/config/env';
import { q } from '@/lib/db';
import { report } from '@/lib/report';
import { TZ } from '@/lib/time';
import { GoogleApiError, isGoogleRetryable } from '@/lib/adapters/google/http';
import {
  authorizationUrl,
  exchangeCode,
  getCalendar,
  GMAIL_SEND_SCOPE,
  insertCalendar,
  refreshAccessToken,
  revokeToken,
  verifiedEmailFromIdToken,
  wantedScopes,
} from '@/lib/adapters/google/oauth';
import { decryptToken, encryptToken } from './crypto';

/** httpOnly, Lax (Google's redirect back is a top-level GET), scoped to the callback, 10 minutes. */
export const STATE_COOKIE = 'twj_gstate';
export const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/api/admin/google/callback',
  maxAge: 600,
} as const;

export function calendarName(): string {
  return getEnv().APP_MODE === 'production' ? 'Time with Jon' : 'Time with Jon (test)';
}

const b64url = (buf: Buffer) => buf.toString('base64url');
/** The account allowed to connect: the first admin address (Jon's Gmail in production). */
const connectAccount = () => getEnv().ADMIN_EMAILS[0] ?? '';

/** The consent URL and the cookie that binds Google's answer to this browser (state + PKCE verifier). */
export function startConnect(): { url: string; cookie: string } {
  const state = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(32));
  const codeChallenge = b64url(createHash('sha256').update(verifier).digest());
  const url = authorizationUrl({ state, codeChallenge, loginHint: connectAccount() });
  return { url, cookie: `${state}.${verifier}` };
}

/** Constant-time state check; returns the PKCE verifier when Google's `state` matches the cookie. */
export function verifierFor(cookie: string | undefined, state: string): string | null {
  const [expected, verifier] = (cookie ?? '').split('.');
  if (!expected || !verifier || !state) return null;
  const a = Buffer.from(expected);
  const b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b) ? verifier : null;
}

export function sameScopeSet(
  granted: readonly string[],
  wanted: readonly string[] = wantedScopes(),
): boolean {
  const g = new Set(granted);
  return g.size === wanted.length && wanted.every((s) => g.has(s));
}

export type ConnectResult =
  | { ok: true; calendarCreated: boolean }
  | { ok: false; reason: 'foreign_account' | 'scopes' | 'no_refresh_token' };

interface ConnectionRow {
  account_email: string;
  refresh_token_enc: Buffer | null;
  calendar_id: string | null;
}

export async function loadConnection(): Promise<ConnectionRow | null> {
  const rows = await q<ConnectionRow>(
    `select account_email, refresh_token_enc, calendar_id from oauth_connection where provider = 'google'`,
  );
  return rows[0] ?? null;
}

async function revokeQuietly(token: string, area: string): Promise<void> {
  try {
    await revokeToken(token);
  } catch (e) {
    report(e, { area });
  }
}

/** T3.4.02's guard refuses writes to `primary`; the stored reference must never be it either (pr35 F4). */
function refusePrimary(id: string): string {
  if (id === 'primary') throw new Error('refusing to store the primary calendar');
  return id;
}

/**
 * Reuse the stored calendar if Google still has it; create "Time with Jon" only when none is usable (AC4).
 * A new calendar's id is written at once, before anything else can fail, so a retry never creates a second one.
 */
async function ensureCalendar(
  accessToken: string,
  email: string,
  stored: ConnectionRow | null,
): Promise<{ id: string; created: boolean }> {
  // A calendar stored for another account (e.g. the staging test account changed) is not ours to probe (pr35 F3b).
  const storedId = stored && stored.account_email === email ? stored.calendar_id : null;
  if (storedId) {
    try {
      return { id: refusePrimary((await getCalendar(accessToken, storedId)).id), created: false };
    } catch (e) {
      // Only a calendar Google says is gone (Jon deleted it) is replaced; any other failure aborts the connect.
      if (!(e instanceof GoogleApiError && (e.status === 404 || e.status === 410))) throw e;
    }
  }
  const id = refusePrimary((await insertCalendar(accessToken, calendarName(), TZ)).id);
  await q(
    `insert into oauth_connection (provider, account_email, refresh_token_enc, scopes, calendar_id, last_error)
     values ('google', $1, null, '{}', $2, 'disconnected')
     on conflict (provider) do update set calendar_id = excluded.calendar_id`,
    [email, id],
  );
  return { id, created: true };
}

/** A refused grant for Jon's own account: Google's revoke also killed the stored token, so say so (pr35 F1). */
async function markDisconnected(): Promise<void> {
  accessTokenCache = null;
  await q(
    `update oauth_connection set refresh_token_enc = null, last_error = 'disconnected' where provider = 'google'`,
  );
}

export async function completeConnect(code: string, verifier: string): Promise<ConnectResult> {
  const grant = await exchangeCode(code, verifier);
  const email = verifiedEmailFromIdToken(grant.idToken);
  const refuse = async (reason: Exclude<ConnectResult, { ok: true }>['reason']): Promise<ConnectResult> => {
    // Never keep a grant we won't use: a foreign account's or a wrong-scope token is revoked at once.
    await revokeQuietly(grant.refreshToken ?? grant.accessToken, 'google_connect_refused');
    // Revoking Jon's own grant revokes the whole user+client grant at Google, the stored token included.
    if (email && email === connectAccount()) await markDisconnected();
    return { ok: false, reason };
  };
  if (!email || email !== connectAccount()) return refuse('foreign_account');
  if (!sameScopeSet(grant.scopes)) return refuse('scopes');
  if (!grant.refreshToken) return refuse('no_refresh_token');

  const calendar = await ensureCalendar(grant.accessToken, email, await loadConnection());
  await q(
    `insert into oauth_connection
       (provider, account_email, refresh_token_enc, scopes, calendar_id, last_ok_at, last_error, connected_at)
     values ('google', $1, $2, $3, $4, now(), null, now())
     on conflict (provider) do update set account_email = excluded.account_email,
       refresh_token_enc = excluded.refresh_token_enc, scopes = excluded.scopes, calendar_id = excluded.calendar_id,
       last_ok_at = now(), last_error = null, connected_at = now()`,
    [email, encryptToken(grant.refreshToken), [...wantedScopes()], calendar.id],
  );
  accessTokenCache = cacheEntry(grant.accessToken, grant.expiresInSec);
  return { ok: true, calendarCreated: calendar.created };
}

export class GoogleRevokeUnavailableError extends Error {
  override name = 'GoogleRevokeUnavailableError';
}

/**
 * Revokes at Google, then forgets the token (pr35 F5). `revoked: false` = the token was forgotten but Google
 * was never told (a lost key), so A7 points Jon at myaccount.google.com/permissions. A TRANSIENT revoke failure
 * (5xx, 429, timeout) keeps the grant stored and throws GoogleRevokeUnavailableError, so Jon can retry: saying
 * "disconnected" while the grant is still live at Google would be a lie. A 4xx (already revoked) counts as done.
 */
export async function disconnectGoogle(): Promise<{ revoked: boolean }> {
  const row = await loadConnection();
  accessTokenCache = null;
  if (!row?.refresh_token_enc) return { revoked: true };
  let plain: string | null = null;
  try {
    plain = decryptToken(row.refresh_token_enc).plain;
  } catch (e) {
    report(e, { area: 'google_disconnect' }); // a lost key must not block Disconnect; Jon can revoke in Google
  }
  if (plain) {
    try {
      await revokeToken(plain);
    } catch (e) {
      if (isGoogleRetryable(e))
        throw new GoogleRevokeUnavailableError('Google revoke unavailable', { cause: e });
      if (!(e instanceof GoogleApiError)) throw e;
    }
  }
  await markDisconnected();
  return { revoked: plain !== null };
}

/**
 * pr36-review F1: for L4's Gmail API mailer (src/lib/adapters/gmail/token.ts). True only when a token is stored
 * AND its granted scopes include gmail.send; the mailer fails closed (MailerNotConfiguredError) otherwise.
 */
export async function gmailSendGranted(): Promise<boolean> {
  const rows = await q<{ ok: boolean }>(
    `select refresh_token_enc is not null and $1 = any(scopes) as ok from oauth_connection where provider = 'google'`,
    [GMAIL_SEND_SCOPE],
  );
  return rows[0]?.ok === true;
}

export class GoogleNotConnectedError extends Error {
  override name = 'GoogleNotConnectedError';
}

let accessTokenCache: { token: string; expiresAt: number } | null = null;

/** At most 5 minutes (pr35 F5): another warm instance must not keep using a token after a Disconnect for long. */
const ACCESS_TOKEN_CACHE_MAX_MS = 5 * 60_000;
function cacheEntry(token: string, expiresInSec: number) {
  const ttl = Math.min((expiresInSec - 60) * 1000, ACCESS_TOKEN_CACHE_MAX_MS);
  return { token, expiresAt: Date.now() + ttl };
}

/**
 * An access token for the gateway and free/busy (T3.4, T3.5). Refreshes when needed, records the outcome on
 * the row, and re-encrypts a token still under the previous key (T3.3.02 rotation).
 */
export async function googleAccessToken(): Promise<string> {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now()) return accessTokenCache.token;
  const row = await loadConnection();
  if (!row?.refresh_token_enc) throw new GoogleNotConnectedError('Google is not connected');
  const { plain, stale } = decryptToken(row.refresh_token_enc);
  let grant;
  try {
    grant = await refreshAccessToken(plain);
  } catch (e) {
    if (e instanceof GoogleApiError) {
      // Compare-and-swap on the token bytes read: a Disconnect or reconnect meanwhile keeps its own state.
      await q(
        `update oauth_connection set last_error = $1 where provider = 'google' and refresh_token_enc = $2`,
        [e.reason || `http_${e.status}`, row.refresh_token_enc],
      );
    }
    throw e;
  }
  // pr35 F2: compare-and-swap. A refresh that finishes after a Disconnect (or a reconnect's new token) must not
  // write the old token back or clear last_error='disconnected'; then its access token isn't cached either.
  const updated = await q(
    `update oauth_connection set last_ok_at = now(), last_error = null,
       refresh_token_enc = coalesce($1, refresh_token_enc)
     where provider = 'google' and refresh_token_enc = $2 returning 1`,
    [stale ? encryptToken(plain) : null, row.refresh_token_enc],
  );
  if (updated.length === 0) throw new GoogleNotConnectedError('Google connection changed during the refresh');
  accessTokenCache = cacheEntry(grant.accessToken, grant.expiresInSec);
  return grant.accessToken;
}

/** Google refused the cached access token (401): drop it so the next call refreshes. */
export function forgetAccessToken(): void {
  accessTokenCache = null;
}

/** Tests only: the module-level cache would leak between cases. */
export const resetAccessTokenCacheForTests = forgetAccessToken;
