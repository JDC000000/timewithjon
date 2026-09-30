// src/features/calendar/crypto.ts — T3.3.02 (AD-6): the Google refresh token is encrypted at rest with AES-256-GCM.
// Stored layout: iv(12) ‖ tag(16) ‖ ciphertext. The key is GOOGLE_TOKEN_ENC_KEY (base64, 32 bytes), Vercel env only.
//
// Key rotation: set GOOGLE_TOKEN_ENC_KEY_PREVIOUS to the old key and GOOGLE_TOKEN_ENC_KEY to the new one, then
// redeploy. decryptToken() tries the current key first, then the previous one, and says which one worked; the
// reader (connection.ts) re-encrypts a stale value under the current key. Once /api/health shows a fresh
// last_ok_at, remove the previous key. GCM's tag makes a wrong key fail loudly, never decrypt to garbage.
import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv, isAes256KeyBase64 } from '@/config/env';

const IV_BYTES = 12;
const TAG_BYTES = 16;

export class TokenKeyError extends Error {
  override name = 'TokenKeyError';
}
export class TokenDecryptError extends Error {
  override name = 'TokenDecryptError';
}

/** Strict base64 of exactly 32 bytes (Buffer.from alone would silently accept junk). */
export function parseTokenKey(b64: string | undefined, name: string): Buffer {
  if (!b64) throw new TokenKeyError(`${name} is not set`);
  if (!isAes256KeyBase64(b64)) throw new TokenKeyError(`${name} must be base64 of exactly 32 bytes`);
  return Buffer.from(b64, 'base64');
}

function keys(): { current: Buffer; previous: Buffer | null } {
  const env = getEnv();
  return {
    current: parseTokenKey(env.GOOGLE_TOKEN_ENC_KEY, 'GOOGLE_TOKEN_ENC_KEY'),
    previous: env.GOOGLE_TOKEN_ENC_KEY_PREVIOUS
      ? parseTokenKey(env.GOOGLE_TOKEN_ENC_KEY_PREVIOUS, 'GOOGLE_TOKEN_ENC_KEY_PREVIOUS')
      : null,
  };
}

export function encryptWith(key: Buffer, plain: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/** Returns null when the key is wrong or the bytes were tampered with (the GCM tag doesn't verify). */
export function decryptWith(key: Buffer, buf: Buffer): string | null {
  if (buf.length <= IV_BYTES + TAG_BYTES) return null;
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}

export function encryptToken(plain: string): Buffer {
  return encryptWith(keys().current, plain);
}

/** `stale` = it only opened with the previous key, so the caller should store encryptToken(plain) again. */
export function decryptToken(buf: Buffer): { plain: string; stale: boolean } {
  const { current, previous } = keys();
  const plain = decryptWith(current, buf);
  if (plain !== null) return { plain, stale: false };
  const old = previous ? decryptWith(previous, buf) : null;
  if (old !== null) return { plain: old, stale: true };
  throw new TokenDecryptError('the stored Google token does not open with the configured keys');
}
