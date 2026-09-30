import { describe, expect, it } from 'vitest';
import {
  generateInviteSecret,
  parseForParam,
  signCookie,
  verifyCookie,
  newActionToken,
  hashActionToken,
  safeEqual,
} from '@/features/invites/tokens';
import { isPreviewBot } from '@/features/invites/bots';
import { RequestBody } from '@/features/requests/schema';
describe('C2 tokens', () => {
  it('secrets are 8 Crockford chars and parse back', () => {
    for (let i = 0; i < 200; i++) {
      const s = generateInviteSecret();
      expect(s).toMatch(/^[0-9a-hjkmnp-tv-z]{8}$/);
      expect(parseForParam(`dave-${s}`)).toEqual({ slug: 'dave', secret: s });
    }
  });
  it('?for=dave resolves to nothing', () => {
    expect(parseForParam('dave')).toBeNull();
  });
  it('multi-part slugs parse', () => {
    expect(parseForParam('mary-jo-k7q2m9xp')).toEqual({ slug: 'mary-jo', secret: 'k7q2m9xp' });
  });
  it('signed cookies verify, expire and reject tampering', () => {
    const c = signCookie('invite', 'inv_123', 60, 'k', 0);
    expect(verifyCookie('invite', c, 'k', 1000)).toBe('inv_123');
    expect(verifyCookie('invite', c, 'k', 61_000)).toBeNull();
    expect(verifyCookie('invite', c.replace('inv_123', 'inv_999'), 'k', 1000)).toBeNull();
    expect(verifyCookie('invite', c, 'other', 1000)).toBeNull();
    expect(verifyCookie('req', c, 'k', 1000)).toBeNull(); // L1: an invite cookie is not a request capability
  });
  it('action tokens hash deterministically to 32 bytes', () => {
    const t = newActionToken();
    expect(t.hash.length).toBe(32);
    expect(hashActionToken(t.raw).equals(t.hash)).toBe(true);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
  });
  it('preview bots and HEAD never count', () => {
    expect(isPreviewBot('facebookexternalhit/1.1')).toBe(true);
    expect(isPreviewBot('Mozilla/5.0 (iPhone) Safari', 'HEAD')).toBe(true);
    expect(isPreviewBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Mobile Safari')).toBe(false);
  });
});
describe('T1.7 RequestBody', () => {
  const ok = {
    clientKey: crypto.randomUUID(),
    dish: 'the-flat-white',
    name: 'Dave',
    email: 'dave@example.com',
    crew: 1,
    slotIds: [crypto.randomUUID()],
  };
  it('accepts a minimal Flat White', () => {
    expect(RequestBody.safeParse(ok).success).toBe(true);
  });
  it('rejects a bad email and crew 0', () => {
    expect(RequestBody.safeParse({ ...ok, email: 'dave@example' }).success).toBe(false);
    expect(RequestBody.safeParse({ ...ok, crew: 0 }).success).toBe(false);
  });
  it('accepts crew 20 (big crew is flagged, not refused)', () => {
    expect(RequestBody.safeParse({ ...ok, crew: 20 }).success).toBe(true);
  });
  it('rejects an 81-char name', () => {
    expect(RequestBody.safeParse({ ...ok, name: 'x'.repeat(81) }).success).toBe(false);
  });
});
