// T2.7.01: the pure parts of the action-token service (lifetimes and states). The database half is in
// tests/int/manage.int.test.ts.
import { describe, expect, it } from 'vitest';
import { SITE } from '../../../../tests/fixtures/unit-env';
import { manageExpiry, singleUseExpiry, tokenState, tokenUrl } from '@/features/invites/action-tokens';

const DAY = 86400_000;
const now = new Date('2027-03-15T18:00:00Z');

describe('lifetimes (§6 action_token)', () => {
  it('manage: the booking end + 7 days, or 120 days from issue if never locked', () => {
    const end = new Date('2027-05-13T21:00:00Z');
    expect(manageExpiry(end, now).getTime()).toBe(end.getTime() + 7 * DAY);
    expect(manageExpiry(null, now).getTime()).toBe(now.getTime() + 120 * DAY);
  });
  it('single-use: with its offer, or 14 days', () => {
    const offerEnd = new Date('2027-03-17T18:00:00Z');
    expect(singleUseExpiry(offerEnd, now)).toBe(offerEnd);
    expect(singleUseExpiry(null, now).getTime()).toBe(now.getTime() + 14 * DAY);
  });
});

describe('tokenState', () => {
  const later = new Date(now.getTime() + 1);
  it('valid until the expiry instant, expired at it', () => {
    expect(tokenState({ purpose: 'manage', expires_at: later, used_at: null }, now)).toBe('valid');
    expect(tokenState({ purpose: 'manage', expires_at: now, used_at: null }, now)).toBe('expired');
  });
  it('a spent single-use token is used (even once expired); a manage token is never used', () => {
    expect(tokenState({ purpose: 'take_offer', expires_at: later, used_at: now }, now)).toBe('used');
    expect(tokenState({ purpose: 'pick_new_date', expires_at: now, used_at: now }, now)).toBe('used');
    expect(tokenState({ purpose: 'manage', expires_at: later, used_at: now }, now)).toBe('valid');
  });
});

describe('tokenUrl', () => {
  it('the token rides in the query string (stripped from logs and Sentry), on our own origin', () => {
    const url = new URL(tokenUrl('manage', 'abc_-123'));
    expect(url.origin).toBe(new URL(SITE).origin);
    expect(url.pathname).toBe('/manage');
    expect(url.searchParams.get('t')).toBe('abc_-123');
    expect(tokenUrl('offer', 'x')).toMatch(/\/offer\?t=x$/);
  });
});
