// TSD v1.9: Google's attendee states map to guest_rsvp at the adapter boundary.
import { describe, expect, it } from 'vitest';
import { GOOGLE_RESPONSE_STATUSES, toGuestRsvp } from '@/lib/adapters/google/rsvp';
import { JON_FLAGS } from '@/content/microcopy';

describe('guest RSVP mapping', () => {
  it('maps the 4 Google states, in order, to pending / yes / no / maybe', () => {
    expect(GOOGLE_RESPONSE_STATUSES.map(toGuestRsvp)).toEqual(['pending', 'yes', 'no', 'maybe']);
  });
  it('treats unknown or missing values as pending', () => {
    expect(toGuestRsvp('somethingNew')).toBe('pending');
    expect(toGuestRsvp(undefined)).toBe('pending');
    expect(toGuestRsvp(null)).toBe('pending');
  });
  it("uses the TSD v1.9 flag for 'no'", () => {
    expect(JON_FLAGS.rsvpNo).toBe('Can’t make it (per Google): check with them');
  });
});
