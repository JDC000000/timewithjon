// src/features/availability/broken-offers.ts — the live stand-by offers a new booking breaks. A stand-by offer holds
// one window for one guest (rule 2(f)); a lock elsewhere can make that window unlockable without overlapping it: a
// Big Day that day (rule 2(e)), the week reaching its cap (2(h)), a dish's one-a-week. Such an offer is dead (its take
// would be refused) yet live for 48 hours, so it is withdrawn with the lock. Pure.
import { dishBySlug } from '@/content/menu-helpers';
import { canLock, type CanLockInput } from './canLock';
import { isOfferLive, slotCountsToward } from './rules';
import type { Booking, CountsToward, Offer, RequestStatus, Slot } from './types';

export interface OfferOwner {
  status: RequestStatus;
  countsToward: CountsToward;
  dish: string;
}

/**
 * The ids of other requests' live stand-by offers whose window a take would pass without `booking` and fail with
 * it. An offer already dead before is not this booking's doing (left to its 48 h expiry, as before).
 */
export function offersBrokenBy(a: {
  booking: Booking;
  offers: Offer[];
  owners: Map<string, OfferOwner>;
  slots: Slot[];
  now: Date;
  bookings: Booking[];
  blocks: CanLockInput['blocks'];
  weeks: CanLockInput['weeks'];
  settings: CanLockInput['settings'];
}): string[] {
  const slots = new Map(a.slots.map((s) => [s.id, s]));
  const after = [...a.bookings, a.booking];
  return a.offers
    .filter((o) => o.kind === 'standby_open' && isOfferLive(o, a.now) && o.requestId !== a.booking.requestId)
    .filter((o) => {
      const owner = a.owners.get(o.requestId);
      if (!owner) return false;
      const targets: CanLockInput['target'][] = o.slotIds.length
        ? o.slotIds.flatMap((id) => (slots.has(id) ? [{ slot: slots.get(id)! }] : []))
        : o.ranges.map((range) => ({ range }));
      const takes = (bookings: Booking[], target: CanLockInput['target']) =>
        canLock({
          now: a.now,
          request: {
            id: o.requestId,
            status: owner.status,
            // as the take would lock it (lock.ts): a slot's kind comes from the dish
            countsToward: 'slot' in target ? slotCountsToward(dishBySlug(owner.dish)) : owner.countsToward,
            dish: owner.dish,
          },
          mode: 'lock',
          target,
          bookings,
          blocks: a.blocks,
          weeks: a.weeks,
          offers: [], // which offer holds what is the overlap check's (offersHolding), not this one's
          settings: a.settings,
        }).ok;
      return targets.some((t) => takes(a.bookings, t)) && !targets.some((t) => takes(after, t));
    })
    .map((o) => o.id);
}
