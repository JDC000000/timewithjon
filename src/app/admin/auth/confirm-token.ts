// src/app/admin/auth/confirm-token.ts — T2.1.U1 (V5, g1 #20 (a)): the A1c interstitial's CSRF token. The GET page
// signs the emailed token_hash with an expiry; the POST only spends the token_hash when the form it came from was
// our own interstitial for that exact link (plus the Origin check). key = HKDF(SESSION_SIGNING_SECRET,
// 'twj-a1c-csrf-v1'): no new secret. Nothing here is logged. Node runtime only.
import 'server-only';
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/config/env';

/** Supabase's token hash: SHA-224 hex (T2.1.04), optionally pkce_-prefixed. */
export const TOKEN_HASH = /^(pkce_)?[0-9a-f]{56}$/;
/** The OTP lives 900 s (Supabase Auth config); the interstitial's token lives no longer. */
export const CONFIRM_TTL_SEC = 900;
export const ADMIN_HOME = '/admin';
/** "The link didn't work, use the code" (no token echoed). */
export const SIGN_IN_FAILED = '/admin/sign-in?error=link';

function key(): Buffer {
  return Buffer.from(hkdfSync('sha256', getEnv().SESSION_SIGNING_SECRET, '', 'twj-a1c-csrf-v1', 32));
}
const mac = (tokenHash: string, exp: number) =>
  createHmac('sha256', key()).update(`a1c:v1:${tokenHash}:${exp}`).digest();

/** `exp.mac` for this token_hash. */
export function signConfirm(tokenHash: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + CONFIRM_TTL_SEC;
  return `${exp}.${mac(tokenHash, exp).toString('base64url')}`;
}

export function verifyConfirm(tokenHash: string, csrf: string, now = Date.now()): boolean {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(csrf);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp * 1000 <= now || exp * 1000 > now + CONFIRM_TTL_SEC * 1000) return false;
  const want = mac(tokenHash, exp);
  const got = Buffer.from(m[2]!, 'base64url');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The link's query, exactly as T2.1.04 accepted it: one type=email and one well-formed token_hash, else null. */
export function linkTokenHash(params: URLSearchParams): string | null {
  const types = params.getAll('type');
  const hashes = params.getAll('token_hash');
  if (types.length !== 1 || types[0] !== 'email' || hashes.length !== 1) return null;
  return TOKEN_HASH.test(hashes[0]!) ? hashes[0]! : null;
}
