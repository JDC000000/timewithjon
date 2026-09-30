// src/features/calendar/rsvp-watch.ts — T3.15.01 (M3): the guest RSVP watch, one events.list per tick on the
// app calendar. The guest's answer is stored as guest_rsvp; a new 'no' shows Jon's flag (JON_FLAGS.rsvpNo) and
// puts the ball in his court (awaiting_jon_since). The request's status NEVER changes here: Jon decides.
import 'server-only';
import { adapters } from '@/lib/adapters';
import type { GuestRsvp } from '@/lib/adapters/types';
import { q } from '@/lib/db';
import { GoogleNotConnectedError } from './connection';

interface Watched {
  id: string;
  google_event_id: string;
  contact_email: string;
  guest_rsvp: GuestRsvp | null;
}

/** Returns how many requests changed. Past bookings and attendee-less (.ics) events are left alone. */
export async function watchRsvps(now: Date): Promise<number> {
  const watched = await q<Watched>(
    // pr41 F7 (M3, M8): a joined guest is an attendee on its HOST's event, so it is watched there, while the
    // host is still locked and ahead. Its answer lands on its own request row, like a host guest's.
    `select r.id, coalesce(h.google_event_id, r.google_event_id) as google_event_id,
            lower(r.contact_email::text) as contact_email, r.guest_rsvp
       from request r
       left join request h on h.id = r.joined_to_request_id
      where r.status = 'locked'
        and case when r.joined_to_request_id is null
                 then r.google_event_id is not null and r.locked_ends_at > $1
                 else h.status = 'locked' and h.google_event_id is not null and h.locked_ends_at > $1 end`,
    [now],
  );
  if (watched.length === 0) return 0; // no Google call when there's nothing to watch
  let events;
  try {
    events = await adapters().calendar.rsvps(now);
  } catch (e) {
    if (e instanceof GoogleNotConnectedError) return 0; // Disconnected: the admin banner says so already
    throw e;
  }
  const byEvent = new Map(events.map((e) => [e.eventId, e.attendees]));
  let changed = 0;
  for (const r of watched) {
    const rsvp = byEvent.get(r.google_event_id)?.find((a) => a.email === r.contact_email)?.rsvp;
    if (!rsvp || rsvp === r.guest_rsvp) continue;
    // Guarded on the value read, so a concurrent Jon action or a second tick can't double-set the wait.
    const updated = await q(
      `update request
          set guest_rsvp = $2::guest_rsvp,
              awaiting_jon_since = case when $2::guest_rsvp = 'no' then coalesce(awaiting_jon_since, $4)
                                        else awaiting_jon_since end
        where id = $1 and guest_rsvp is not distinct from $3::guest_rsvp and status = 'locked'
      returning id`,
      [r.id, rsvp, r.guest_rsvp, now],
    );
    changed += updated.length;
  }
  return changed;
}
