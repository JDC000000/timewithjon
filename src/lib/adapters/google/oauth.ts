// src/lib/adapters/google/oauth.ts — T3.3 (AD-6): Google's OAuth endpoints and the calendar-level calls the
// connect flow needs. Tests replace global fetch with a fake Google, so no real call is ever made from CI.
import 'server-only';
import { getEnv } from '@/config/env';
import { googleFetch } from './http';

/**
 * The scope set decided at G3 from the T0.6 spike (2026-09-25: all four granted, no time limit on the token,
 * a write to `primary` refused). The token response must grant exactly this set (T3.3 AC5).
 */
export const G3_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.freebusy',
] as const;

/** pr36-review F1: the T3.17 Gmail API mailer's scope. Opt-in by env, never part of the G3 default. */
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/** The exact scope set this environment asks for and accepts: G3, plus gmail.send when GOOGLE_GMAIL_SEND=1. */
export function wantedScopes(): readonly string[] {
  return getEnv().GOOGLE_GMAIL_SEND === '1' ? [...G3_SCOPES, GMAIL_SEND_SCOPE] : G3_SCOPES;
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export class GoogleNotConfiguredError extends Error {
  override name = 'GoogleNotConfiguredError';
}

function client(): { id: string; secret: string } {
  const env = getEnv();
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_TOKEN_ENC_KEY) {
    throw new GoogleNotConfiguredError('Google OAuth is not configured in this environment');
  }
  return { id: env.GOOGLE_OAUTH_CLIENT_ID, secret: env.GOOGLE_OAUTH_CLIENT_SECRET };
}

/** Proto and previews have no client (they always use the mock gateway, AD-6), so connect doesn't exist there. */
export function googleConfigured(): boolean {
  try {
    client();
    return true;
  } catch {
    return false;
  }
}

export function redirectUri(): string {
  return `${getEnv().NEXT_PUBLIC_SITE_URL}/api/admin/google/callback`;
}

export function authorizationUrl(p: { state: string; codeChallenge: string; loginHint: string }): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: wantedScopes().join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    login_hint: p.loginHint,
  }).toString();
  return url.toString();
}

export interface TokenGrant {
  refreshToken: string | null;
  accessToken: string;
  expiresInSec: number;
  scopes: string[];
  idToken: string | null;
}

interface RawToken {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

function grantOf(raw: RawToken): TokenGrant {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresInSec: raw.expires_in ?? 3600,
    scopes: (raw.scope ?? '').split(' ').filter(Boolean),
    idToken: raw.id_token ?? null,
  };
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenGrant> {
  const { id, secret } = client();
  const raw = await googleFetch<RawToken>(TOKEN_URL, {
    op: 'token_exchange',
    form: {
      code,
      code_verifier: codeVerifier,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    },
  });
  return grantOf(raw);
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenGrant> {
  const { id, secret } = client();
  const raw = await googleFetch<RawToken>(TOKEN_URL, {
    op: 'token_refresh',
    form: { refresh_token: refreshToken, client_id: id, client_secret: secret, grant_type: 'refresh_token' },
  });
  return grantOf(raw);
}

/** Revokes the whole grant (refresh and access tokens). */
export async function revokeToken(token: string): Promise<void> {
  await googleFetch<unknown>(REVOKE_URL, { op: 'token_revoke', form: { token } });
}

/**
 * The account's verified email from the id_token. It came straight from Google's token endpoint over TLS, so
 * OIDC Core 3.1.3.7 lets the TLS check stand in for the signature; the issuer and audience are still checked.
 */
export function verifiedEmailFromIdToken(idToken: string | null): string | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (!GOOGLE_ISSUERS.has(String(claims.iss)) || claims.aud !== client().id) return null;
    if (claims.email_verified !== true || typeof claims.email !== 'string') return null;
    return claims.email.trim().toLowerCase();
  } catch {
    return null;
  }
}

/** calendars.get: proves the stored calendar still exists and the token can reach it. */
export async function getCalendar(accessToken: string, calendarId: string): Promise<{ id: string }> {
  return googleFetch<{ id: string }>(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}`, {
    op: 'calendars_get',
    accessToken,
  });
}

export async function insertCalendar(
  accessToken: string,
  summary: string,
  timeZone: string,
): Promise<{ id: string }> {
  return googleFetch<{ id: string }>(`${CALENDAR_API}/calendars`, {
    op: 'calendars_insert',
    accessToken,
    json: { summary, timeZone },
  });
}
