// T1.2 AC2–4 (non-UI parts)
import { describe, expect, it } from 'vitest';
import { landingModel } from '@/features/invites/landing-model';
import type { Invite } from '@/features/invites/repo';
const inv = (over: Partial<Invite>): Invite => ({
  id: 'i',
  kind: 'personal',
  is_test: true,
  name_slug: 'dave',
  display_name: 'Dave',
  our_things: ['the Seymour lap', 'Tofino again'],
  picked_dish: 'the-shore-ride',
  prefill_name: 'Dave',
  prefill_email: null,
  revoked_at: null,
  ...over,
});
describe('landingModel', () => {
  it('AC2 personal token shows the name, line and Book {dish}', () => {
    expect(landingModel({ state: 'valid', invite: inv({}) })).toMatchObject({
      variant: 'personal',
      name: 'Dave',
      heroLine: 'We keep saying we should get together or do that epic trip.', // Jon, 2026-10-05: whatever their things
      cta: { label: 'Book The Shore Ride', href: '/book/the-shore-ride' },
    });
  });
  it('AC3 no/invalid invite shows the open variant; stale flagged', () => {
    expect(landingModel({ state: 'none' })).toMatchObject({ variant: 'open', stale: false });
    expect(landingModel({ state: 'valid', invite: inv({ our_things: [] }) })).toMatchObject({
      heroLine: 'We keep saying we should get together or do that epic trip.',
    });
    expect(landingModel({ state: 'none' })).toMatchObject({
      heroLine: 'We keep saying we should get together or do that epic trip.',
    });
    expect(landingModel({ state: 'stale' })).toMatchObject({ variant: 'open', stale: true });
  });
  it('AC4 a picked dish that is not bookable shows no Book button for it', () => {
    expect(landingModel({ state: 'valid', invite: inv({ picked_dish: 'the-bluebird' }) }).cta).toEqual({
      label: 'See the whole activity menu',
      href: '/menu',
    });
  });
});
