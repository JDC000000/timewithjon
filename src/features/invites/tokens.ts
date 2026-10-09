// src/lib/security/tokens.ts — C2 invite secrets, signed cookies, action tokens. Node runtime only.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz'; // 32 symbols, no i l o u

/** 8 Crockford base32 chars = 40 bits (C-7). */
export function generateInviteSecret(): string {
  const bytes = randomBytes(5); // 40 bits
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = '';
  for (let i = 7; i >= 0; i--) out += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  return out;
}

/** `?for=dave-k7q2m9xp` -> { slug:'dave', secret:'k7q2m9xp' }. Lookup uses the secret only. */
export function parseForParam(raw: string | null | undefined): { slug: string; secret: string } | null {
  if (!raw) return null;
  const m = /^([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-hjkmnp-tv-z]{8})$/.exec(raw.trim().toLowerCase());
  return m ? { slug: m[1]!, secret: m[2]! } : null;
}

const b64u = (b: Buffer) => b.toString('base64url');

/** What a signed cookie is for. The MAC covers it, so an invite cookie never verifies as a request capability (L1). */
export type CookiePurpose = 'invite' | 'req' | 'dev' | 'story' | 'switch' | 'device';

const cookieMac = (purpose: CookiePurpose, value: string, exp: number, key: string) =>
  createHmac('sha256', key).update(`${purpose}.${value}.${exp}`).digest();

/** value.expEpochSec.hmac — used for twj_invite (180 d) and twj_req (2 h). */
export function signCookie(
  purpose: CookiePurpose,
  value: string,
  ttlSeconds: number,
  key: string,
  now = Date.now(),
): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return `${value}.${exp}.${b64u(cookieMac(purpose, value, exp, key))}`;
}

export function verifyCookie(
  purpose: CookiePurpose,
  cookie: string | undefined,
  key: string,
  now = Date.now(),
): string | null {
  if (!cookie) return null;
  const parts = cookie.split('.');
  if (parts.length !== 3) return null;
  const [value, expStr, mac] = parts as [string, string, string];
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp * 1000 <= now) return null;
  const want = cookieMac(purpose, value, exp, key);
  const got = Buffer.from(mac, 'base64url');
  return got.length === want.length && timingSafeEqual(got, want) ? value : null;
}

/** Action tokens (§6): raw 32 bytes live only in the email; DB stores SHA-256. */
export function newActionToken(): { raw: string; hash: Buffer } {
  const raw = b64u(randomBytes(32));
  return { raw, hash: hashActionToken(raw) };
}
export function hashActionToken(raw: string): Buffer {
  return createHash('sha256').update(raw, 'utf8').digest();
}

/** Constant-time string compare (x-cron-secret, AD-8). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
