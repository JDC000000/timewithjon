// T3.3.02: AES-256-GCM token crypto (round trip, tamper, wrong key, rotation) and the strict key check.
import '../../../../tests/fixtures/unit-env';
import '../../../../tests/fixtures/google-env';
import { TEST_ENC_KEY, TEST_ENC_KEY_OLD } from '../../../../tests/fixtures/fake-google';

import { describe, expect, it } from 'vitest';
import { isAes256KeyBase64 } from '@/config/env';
import { decryptToken, decryptWith, encryptToken, encryptWith, parseTokenKey } from '../crypto';

const current = Buffer.from(TEST_ENC_KEY, 'base64');
const old = Buffer.from(TEST_ENC_KEY_OLD, 'base64');

// No KDF here (a raw 32-byte key): the work is microseconds. The first test also pays the cold env parse and
// module init, which once passed 5 s on a loaded runner, so the suite gets an explicit budget.
describe('token crypto', { timeout: 20_000 }, () => {
  it('round-trips, with a fresh 12-byte IV and a 16-byte tag before the ciphertext', () => {
    const a = encryptToken('1//refresh-token');
    const b = encryptToken('1//refresh-token');
    expect(a.length).toBe(12 + 16 + '1//refresh-token'.length);
    expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false);
    expect(decryptToken(a)).toEqual({ plain: '1//refresh-token', stale: false });
    expect(decryptWith(current, a)).toBe('1//refresh-token');
  });

  it('refuses a tampered IV, tag or ciphertext, and a truncated value', () => {
    const enc = encryptToken('secret');
    for (const i of [0, 12, 28]) {
      const bad = Buffer.from(enc);
      bad[i] = (bad[i] ?? 0) ^ 1;
      expect(decryptWith(current, bad)).toBeNull();
      expect(() => decryptToken(bad)).toThrow(/does not open/);
    }
    expect(decryptWith(current, enc.subarray(0, 28))).toBeNull();
  });

  it('rotation: a value under the previous key opens and is flagged stale; a third key does not open', () => {
    expect(decryptToken(encryptWith(old, 'x'))).toEqual({ plain: 'x', stale: true });
    expect(() => decryptToken(encryptWith(Buffer.alloc(32, 3), 'x'))).toThrow(/does not open/);
  });

  it('keys must be strict base64 of exactly 32 bytes', () => {
    expect(isAes256KeyBase64(TEST_ENC_KEY)).toBe(true);
    expect(isAes256KeyBase64(Buffer.alloc(31).toString('base64'))).toBe(false);
    expect(isAes256KeyBase64(Buffer.alloc(33).toString('base64'))).toBe(false);
    expect(isAes256KeyBase64(`${TEST_ENC_KEY}\n`)).toBe(false);
    expect(isAes256KeyBase64(TEST_ENC_KEY.replace(/=$/, ''))).toBe(false);
    expect(() => parseTokenKey(undefined, 'K')).toThrow(/K is not set/);
    expect(() => parseTokenKey('abc', 'K')).toThrow(/exactly 32 bytes/);
    expect(parseTokenKey(TEST_ENC_KEY, 'K').equals(current)).toBe(true);
  });
});
