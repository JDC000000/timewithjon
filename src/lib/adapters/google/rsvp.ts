// src/lib/adapters/google/rsvp.ts — TSD v1.9 §6/§9: the ONLY file that names Google's raw attendee
// responseStatus values. Everything past this boundary (DB enum guest_rsvp, admin flags, emails, logs)
// uses GuestRsvp. tests/unit/no-decline.test.ts allowlists this file and nothing else in src/.
import type { GuestRsvp } from '../types';

export const GOOGLE_RESPONSE_STATUSES = ['needsAction', 'accepted', 'declined', 'tentative'] as const;
export type GoogleResponseStatus = (typeof GOOGLE_RESPONSE_STATUSES)[number];

const FROM_GOOGLE: Record<GoogleResponseStatus, GuestRsvp> = {
  needsAction: 'pending',
  accepted: 'yes',
  declined: 'no',
  tentative: 'maybe',
};

/** Unknown or missing values count as 'pending' (Google may add states; never fail a sync over one). */
export function toGuestRsvp(responseStatus: string | null | undefined): GuestRsvp {
  return FROM_GOOGLE[responseStatus as GoogleResponseStatus] ?? 'pending';
}
