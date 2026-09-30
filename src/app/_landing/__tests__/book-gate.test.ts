// T1.2.U3 (S16) + wireframe 04 E: what stands where Book would be.
import { describe, expect, it } from 'vitest';
import { ERRORS } from '@/content';
import { dishBySlug } from '@/content/menu-helpers';
import type { Invite } from '@/features/invites/repo';
import { bookGate } from '../book-gate';

const invite = (kind: Invite['kind']): Invite => ({
  id: 'i',
  kind,
  is_test: true,
  name_slug: 'dave',
  display_name: 'Dave',
  our_things: [],
  picked_dish: null,
  prefill_name: null,
  prefill_email: null,
  revoked_at: null,
});
// Personal links open Feb 25, the open link Mar 1 (Vancouver, PST = UTC-8).
const release = {
  personal_open_at: new Date('2027-02-25T08:00:00Z'),
  general_open_at: new Date('2027-03-01T08:00:00Z'),
};

describe('bookGate', () => {
  it('S16: a stale, revoked or rotated link replaces Book with the stale line', () => {
    expect(bookGate({ state: 'stale' }, null)).toEqual({ kind: 'note', text: ERRORS.stale });
    expect(bookGate({ state: 'stale' }, release, new Date('2027-04-01T00:00:00Z'))).toEqual({
      kind: 'note',
      text: ERRORS.stale,
    });
  });
  it('a bare URL (no invite) says booking works from the link', () => {
    expect(bookGate({ state: 'none' }, null)).toEqual({ kind: 'note', text: ERRORS.noInvite });
  });
  it('before its release a valid invite says when booking opens (Vancouver date)', () => {
    const early = new Date('2027-02-20T12:00:00Z');
    expect(bookGate({ state: 'valid', invite: invite('general') }, release, early)).toEqual({
      kind: 'note',
      text: 'Booking opens March 1.',
    });
    expect(bookGate({ state: 'valid', invite: invite('personal') }, release, early)).toEqual({
      kind: 'note',
      text: 'Booking opens February 25.',
    });
  });
  it('opens at the release instant exactly, per invite kind', () => {
    const at = new Date('2027-02-25T08:00:00Z');
    const justBefore = new Date(at.getTime() - 1);
    expect(bookGate({ state: 'valid', invite: invite('personal') }, release, at)).toEqual({ kind: 'book' });
    expect(bookGate({ state: 'valid', invite: invite('personal') }, release, justBefore).kind).toBe('note');
    expect(bookGate({ state: 'valid', invite: invite('general') }, release, at).kind).toBe('note');
  });
  it('a released invite books; no release times (a preview) books too', () => {
    const late = new Date('2027-04-02T00:00:00Z');
    expect(bookGate({ state: 'valid', invite: invite('general') }, release, late)).toEqual({ kind: 'book' });
    expect(bookGate({ state: 'valid', invite: invite('personal') }, null)).toEqual({ kind: 'book' });
  });
  it('off: a dish that cannot be booked (the Bluebird) gets neither Book nor a note, for any visitor', () => {
    const bluebird = dishBySlug('the-bluebird')!;
    const late = new Date('2027-04-02T00:00:00Z');
    expect(bookGate({ state: 'valid', invite: invite('personal') }, release, late, bluebird)).toEqual({
      kind: 'off',
    });
    expect(bookGate({ state: 'stale' }, null, late, bluebird)).toEqual({ kind: 'off' });
    expect(bookGate({ state: 'none' }, null, late, bluebird)).toEqual({ kind: 'off' });
  });
  it('a bookable dish leaves the invite rules in charge', () => {
    const lunch = dishBySlug('the-long-lunch')!;
    const late = new Date('2027-04-02T00:00:00Z');
    expect(bookGate({ state: 'valid', invite: invite('general') }, release, late, lunch)).toEqual({
      kind: 'book',
    });
    expect(bookGate({ state: 'none' }, null, late, lunch)).toEqual({ kind: 'note', text: ERRORS.noInvite });
  });
  it("off after a dish's last day, judged at the page's own now (Vancouver date)", () => {
    const lunch = { ...dishBySlug('the-long-lunch')!, availableUntil: '2027-05-01' };
    const valid = { state: 'valid', invite: invite('general') } as const;
    expect(bookGate(valid, release, new Date('2027-05-02T06:59:00Z'), lunch)).toEqual({ kind: 'book' });
    expect(bookGate(valid, release, new Date('2027-05-02T07:00:00Z'), lunch)).toEqual({ kind: 'off' });
  });
});
