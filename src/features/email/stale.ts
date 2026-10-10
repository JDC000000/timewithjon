// src/features/email/stale.ts — what a guest email says must still be true when it finally goes out. An email
// held by the daily budget (the next-UTC-day queue) or retried by the tick can leave hours after it was queued;
// by then the guest may have cancelled, the booking may be off or at another time, a joined guest's host may have
// gone, or a later "Locked in" may already have reached them. Such an email is dropped at send time (recorded,
// never sent, never offered for Resend). Anything still true goes out as before. Server-only.
import 'server-only';
import type { TemplateId } from '@/content/emails';
import { q } from '@/lib/db';

/** email_log.last_error of an email dropped because what it says is no longer true. */
export const STALE_ERROR = 'stale';

interface RequestNow {
  status: string;
  joined: boolean;
  host_on: boolean | null;
  starts_at: Date | null;
  ends_at: Date | null;
  /** A "Locked in" (E4) reached the guest after this email was queued. */
  e4_after: boolean;
  /** The offer this email is about (its event key): null when the key names no offer. */
  offer_live: boolean | null;
}

export interface QueuedEmail {
  template: TemplateId;
  request_id: string | null;
  event_key: string | null;
  vars: Record<string, unknown>;
  created_at: Date;
}

/** True when the request has moved on from what this email says (see the rules per template below). */
export async function isStaleOnSend(e: QueuedEmail): Promise<boolean> {
  if (!e.request_id || !(e.template in RULES)) return false;
  const [r] = await q<RequestNow>(
    `select r.status::text as status, r.joined_to_request_id is not null as joined,
            h.status in ('locked', 'done') as host_on,
            case when r.joined_to_request_id is null then r.locked_starts_at else h.locked_starts_at end as starts_at,
            case when r.joined_to_request_id is null then r.locked_ends_at else h.locked_ends_at end as ends_at,
            exists (select 1 from email_log s
                     where s.request_id = r.id and s.template = 'E4' and s.created_at > $2
                       and s.status in ('sent', 'delayed', 'bounced', 'complained')) as e4_after,
            (select o.taken_at is null and o.released_at is null and (o.expires_at is null or o.expires_at > now())
               from offer o where o.id::text = $3) as offer_live
       from request r left join request h on h.id = r.joined_to_request_id
      where r.id = $1`,
    [e.request_id, e.created_at, e.event_key ?? ''],
  );
  return r ? RULES[e.template]!(r, e) : false; // a request gone altogether: the row is the history, send as before
}

/**
 * Booked now (a joined guest: on its host's booking, which must still be on), at the time this email names. The
 * time is compared by the instants E4 carries (lock.ts lockedEmailVars); an older E4 without them names its time
 * only in words, so it is judged by the booking alone (never dropped for a change of wording).
 */
function stillLockedAt(r: RequestNow, e: QueuedEmail): boolean {
  const booked = (r.status === 'locked' || r.status === 'done') && (!r.joined || r.host_on === true);
  if (!booked) return false;
  const { startsAt, endsAt } = e.vars;
  if (typeof startsAt !== 'string' || typeof endsAt !== 'string') return true;
  return r.starts_at?.getTime() === Date.parse(startsAt) && r.ends_at?.getTime() === Date.parse(endsAt);
}

/** An email about an offer: stale once that offer is taken, released or expired; without one, by the request. */
const offerOr = (status: string) => (r: RequestNow) =>
  r.offer_live !== null ? !r.offer_live : r.status !== status;

const RULES: Partial<Record<TemplateId, (r: RequestNow, e: QueuedEmail) => boolean>> = {
  // "Got your times, I'll lock one in": only while the request still waits on Jon and no "Locked in" overtook it.
  E1: (r) => r.status !== 'requested' || r.e4_after,
  E6: (r) => r.status !== 'standby', // "You're on stand-by"
  E4: (r, e) => !stillLockedAt(r, e), // "Locked in: <when>"
  E5: offerOr('needs_new_time'), // Jon's suggested times
  E5b: offerOr('needs_new_time'), // a block moved the booking (with or without times)
  E7: offerOr('standby'), // a freed window for a stand-by guest
  E10: offerOr('needs_new_time'), // a weather call
  E5j: (r) => r.status !== 'needs_new_time', // "That plan fell through": until they have a new time
  E11: (r) => r.status !== 'cancelled', // the guest's cancel
  E17: (r) => r.status !== 'cancelled', // Jon's cancel for the guest
};
