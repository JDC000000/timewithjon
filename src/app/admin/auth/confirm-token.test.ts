// T2.1.U1: the A1c CSRF token (tied to one link, expires with the OTP) and the link's query rules (T2.1.04).
import '../../../../tests/fixtures/unit-env';
import { createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getEnv } from '@/config/env';
import { CONFIRM_TTL_SEC, linkTokenHash, signConfirm, verifyConfirm } from './confirm-token';

const H = 'a'.repeat(56);
const OTHER = 'b'.repeat(56);
const NOW = Date.UTC(2027, 2, 3, 22, 0, 0);

describe('signConfirm / verifyConfirm', () => {
  it('a token verifies for its own link only', () => {
    const t = signConfirm(H, NOW);
    expect(verifyConfirm(H, t, NOW)).toBe(true);
    expect(verifyConfirm(OTHER, t, NOW)).toBe(false);
  });
  it('it lives as long as the OTP, and not a second more', () => {
    const t = signConfirm(H, NOW);
    expect(verifyConfirm(H, t, NOW + CONFIRM_TTL_SEC * 1000 - 1)).toBe(true);
    expect(verifyConfirm(H, t, NOW + CONFIRM_TTL_SEC * 1000)).toBe(false);
  });
  it('a moved expiry, a changed MAC or junk fails', () => {
    const t = signConfirm(H, NOW);
    const [exp, mac] = t.split('.') as [string, string];
    expect(verifyConfirm(H, `${Number(exp) + 1}.${mac}`, NOW)).toBe(false);
    expect(verifyConfirm(H, `${exp}.${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`, NOW)).toBe(false);
    for (const junk of ['', '.', `${exp}.`, `x.${mac}`, `${exp}.${mac}.x`, `${exp}${mac}`]) {
      expect(verifyConfirm(H, junk, NOW), junk).toBe(false);
    }
  });
  it('an expiry further out than one lifetime (forged) is refused', () => {
    const t = signConfirm(H, NOW + 60_000); // signed "in the future"
    expect(verifyConfirm(H, t, NOW)).toBe(false);
  });
});

describe('the CSRF key is domain-separated (pr75-review F3)', () => {
  it('the MAC is keyed by HKDF(SESSION_SIGNING_SECRET, "twj-a1c-csrf-v1"), never by the raw secret', () => {
    const t = signConfirm(H, NOW);
    const [exp, mac] = t.split('.') as [string, string];
    const secret = getEnv().SESSION_SIGNING_SECRET;
    const msg = `a1c:v1:${H}:${exp}`;
    const raw = createHmac('sha256', secret).update(msg).digest('base64url');
    const key = Buffer.from(hkdfSync('sha256', secret, '', 'twj-a1c-csrf-v1', 32));
    const derived = createHmac('sha256', key).update(msg).digest('base64url');
    expect(mac).not.toBe(raw);
    expect(mac).toBe(derived);
    // another HKDF label (e.g. the action-token key) doesn't verify either
    const other = createHmac('sha256', Buffer.from(hkdfSync('sha256', secret, '', 'twj-action-token-v1', 32)))
      .update(msg)
      .digest('base64url');
    expect(verifyConfirm(H, `${exp}.${other}`, NOW)).toBe(false);
  });
});

describe('linkTokenHash (the emailed link query)', () => {
  const q = (s: string) => linkTokenHash(new URLSearchParams(s));
  it('exactly one type=email and one well-formed token_hash', () => {
    expect(q(`token_hash=${H}&type=email`)).toBe(H);
    expect(q(`token_hash=pkce_${H}&type=email`)).toBe(`pkce_${H}`);
  });
  it('any other type, a repeated field or a malformed hash is refused', () => {
    for (const t of ['recovery', 'invite', 'signup', 'email_change', 'magiclink', 'EMAIL', 'Email', '']) {
      expect(q(`token_hash=${H}&type=${t}`), t).toBeNull();
    }
    expect(q(`token_hash=${H}`)).toBeNull();
    expect(q(`token_hash=${H}&type=email&type=email`)).toBeNull();
    expect(q(`token_hash=${H}&token_hash=${H}&type=email`)).toBeNull();
    expect(q(`token_hash=${'A'.repeat(56)}&type=email`)).toBeNull();
    expect(q(`token_hash=${'a'.repeat(55)}&type=email`)).toBeNull();
  });
});
