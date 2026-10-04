// src/features/invites/action-tokens.ts — T2.7.01 the action-token service (§6 action_token, AD-12).
// The raw 32-byte token lives only inside the email; the database stores its SHA-256. findToken() never writes,
// so a GET, a HEAD or a link scanner's prefetch of a token URL changes nothing (T2.7 AC1, N2). Only a POST that
// passes the same-origin check spends a single-use token (consumeToken) or acts on a manage token.
import 'server-only';
import { createHmac, hkdfSync } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getEnv } from '@/config/env';
import { pool } from '@/lib/db';
import { hashActionToken, newActionToken } from './tokens';

/** The manage page sends its token in this header to the picker, form, story and photo APIs (T2.7.02). */
export const MANAGE_HEADER = 'x-twj-manage';

export type TokenPurpose = 'manage' | 'take_offer' | 'pick_new_date';
type Db = Pool | PoolClient;

export interface ActionToken {
  id: string;
  purpose: TokenPurpose;
  request_id: string;
  offer_id: string | null;
  expires_at: Date;
  used_at: Date | null;
}
const COLS = 'id, purpose, request_id, offer_id, expires_at, used_at';

const DAY_MS = 24 * 3600 * 1000;
/** §6: a manage token lasts until the booking's end + 7 days, or 120 days from issue if it's never locked. */
export const MANAGE_AFTER_END_DAYS = 7;
export const MANAGE_UNLOCKED_DAYS = 120;
/** §6: single-use tokens expire with their offer, or after 14 days. */
export const SINGLE_USE_DAYS = 14;

/** base64url of 32 bytes. Anything else is tampered and never reaches the database. */
const RAW_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function manageExpiry(bookingEnd: Date | null, issuedAt: Date): Date {
  return bookingEnd
    ? new Date(bookingEnd.getTime() + MANAGE_AFTER_END_DAYS * DAY_MS)
    : new Date(issuedAt.getTime() + MANAGE_UNLOCKED_DAYS * DAY_MS);
}
export function singleUseExpiry(offerExpiresAt: Date | null, issuedAt: Date): Date {
  return offerExpiresAt ?? new Date(issuedAt.getTime() + SINGLE_USE_DAYS * DAY_MS);
}

/**
 * pr40-review H1 (build-lanes ruling): the link in an email is DETERMINISTIC per email_log row, so a retry
 * re-renders a byte-identical body under the same provider idempotency key (no 409, no second different email,
 * no dead link in the guest's inbox). raw = base64url(HMAC-SHA256(key, 'v1:<email_log_id>:<kind>')), 43 chars;
 * key = HKDF(SESSION_SIGNING_SECRET, 'twj-action-token-v1'). Only its hash is stored, as for every token.
 */
export function emailLinkToken(emailLogId: string, kind: string): string {
  const key = Buffer.from(hkdfSync('sha256', getEnv().SESSION_SIGNING_SECRET, '', 'twj-action-token-v1', 32));
  return createHmac('sha256', key).update(`v1:${emailLogId}:${kind}`).digest('base64url');
}

/**
 * Stores only the hash; returns the raw token for the email link. With `raw` (a deterministic email link), the
 * insert is idempotent: a retry of the same email finds its token already there and changes nothing.
 */
export async function issueToken(
  c: Db,
  a: {
    purpose: TokenPurpose;
    requestId: string;
    offerId?: string | null;
    expiresAt: Date;
    emailLogId?: string | null; // the email it was minted for (link-vars.ts)
    raw?: string; // a deterministic token (emailLinkToken); default: 32 random bytes
  },
): Promise<string> {
  const { raw, hash } = a.raw ? { raw: a.raw, hash: hashActionToken(a.raw) } : newActionToken();
  await c.query(
    `insert into action_token (token_hash, purpose, request_id, offer_id, expires_at, email_log_id)
     values ($1, $2, $3, $4, $5, $6) on conflict (token_hash) do nothing`,
    [hash, a.purpose, a.requestId, a.offerId ?? null, a.expiresAt, a.emailLogId ?? null],
  );
  return raw;
}

/**
 * A fresh manage token for a request (every guest email carries one, C5). Its life follows the booking: the
 * host's end for a joined request, the request's own end when locked, otherwise 120 days from now.
 */
export async function issueManageToken(
  c: Db,
  requestId: string,
  now = new Date(),
  emailLogId: string | null = null,
  raw?: string,
): Promise<string> {
  const { rows } = await c.query<{ ends_at: Date | null }>(
    `select case when coalesce(h.status, r.status) in ('locked', 'done')
                 then coalesce(h.locked_ends_at, r.locked_ends_at) end as ends_at
       from request r left join request h on h.id = r.joined_to_request_id
      where r.id = $1`,
    [requestId],
  );
  return issueToken(c, {
    purpose: 'manage',
    requestId,
    expiresAt: manageExpiry(rows[0]?.ends_at ?? null, now),
    emailLogId,
    raw,
  });
}

/**
 * A lock: every LIVE manage link of the request, and of every guest joined to it and riding it
 * (§6 rule 3; pr40-verify N4), now lasts exactly to the new end + 7 days (§6), so an earlier email's link keeps
 * working and matches the fresh one. An expired link is never brought back (pr40-review M1, L1).
 */
export async function extendManageTokens(c: Db, requestId: string, bookingEnd: Date): Promise<void> {
  await c.query(
    `update action_token set expires_at = $2
      where purpose = 'manage' and expires_at > now()
        and request_id in (select $1::uuid
                           union all
                           select j.id from request j where j.joined_to_request_id = $1 and j.status = 'locked')`,
    [requestId, manageExpiry(bookingEnd, bookingEnd)],
  );
}

/**
 * A booking went back to waiting on Jon (Ask for another time, or its host left): its LIVE manage links last at
 * least the "never locked" lifetime from now (§6, 120 days), so the link doesn't run out at the old end + 7 days
 * while the request is still open. Never shortens a link, never brings an expired one back.
 */
export async function reopenManageTokens(c: Db, requestIds: string[], now: Date): Promise<void> {
  if (!requestIds.length) return;
  await c.query(
    `update action_token set expires_at = greatest(expires_at, $2::timestamptz)
      where purpose = 'manage' and expires_at > now() and request_id = any($1::uuid[])`,
    [requestIds, manageExpiry(null, now)],
  );
}

/** Read-only lookup. null = malformed or unknown (the caller answers 404: tampered, T2.7 AC4). */
export async function findToken(
  raw: string | null | undefined,
  db: Db = pool(),
): Promise<ActionToken | null> {
  if (!raw || !RAW_TOKEN.test(raw)) return null;
  const { rows } = await db.query<ActionToken>(`select ${COLS} from action_token where token_hash = $1`, [
    hashActionToken(raw),
  ]);
  return rows[0] ?? null;
}

export type TokenState = 'valid' | 'expired' | 'used';
/** Pure. A manage token is reusable, so only a single-use token can be 'used'. */
export function tokenState(
  t: Pick<ActionToken, 'purpose' | 'expires_at' | 'used_at'>,
  now = new Date(),
): TokenState {
  if (t.purpose !== 'manage' && t.used_at) return 'used';
  return t.expires_at.getTime() > now.getTime() ? 'valid' : 'expired';
}

/** Spends a single-use token atomically (POST only): exactly one caller wins; null for everyone else. */
export async function consumeToken(c: Db, raw: string): Promise<ActionToken | null> {
  if (!RAW_TOKEN.test(raw)) return null;
  const { rows } = await c.query<ActionToken>(
    `update action_token set used_at = now()
      where token_hash = $1 and used_at is null and expires_at > now() and purpose <> 'manage'
      returning ${COLS}`,
    [hashActionToken(raw)],
  );
  return rows[0] ?? null;
}

/** A valid manage token → its request id (the manage grant, T2.7.02). Never writes. */
export async function manageGrant(raw: string | null | undefined, now = new Date()): Promise<string | null> {
  const t = await findToken(raw);
  return t && t.purpose === 'manage' && tokenState(t, now) === 'valid' ? t.request_id : null;
}

/** The guest-facing token links (the token rides in the query string, which Sentry and our logs strip). */
export type TokenPage = 'manage' | 'offer' | 'new-date';
export function tokenUrl(page: TokenPage, raw: string): string {
  const url = new URL(`/${page}`, getEnv().NEXT_PUBLIC_SITE_URL);
  url.searchParams.set('t', raw);
  return url.toString();
}
