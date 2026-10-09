// src/features/requests/offers.ts — offers for a request (§6 offer). T2.4.01 (lane L1) adds createOffer() here.
import 'server-only';
import type { PoolClient } from 'pg';
import { withTx } from '@/lib/db';

/**
 * Every live offer of the request is released, and its single-use tokens are spent (a guest cancel, Ask for another time, Cancel for the guest):
 * the engine stops holding its windows at once, and its take/pick tokens then show the current state.
 */
export async function releaseLiveOffers(c: PoolClient, requestId: string): Promise<number> {
  const { rowCount } = await c.query(
    `update offer set released_at = now() where request_id = $1 and taken_at is null and released_at is null`,
    [requestId],
  );
  // pr32-review L4, defence in depth: their single-use take/pick tokens are spent too, so a stale email link can
  // only ever show the current state (T2.7 AC2). Lane L1's take/pick POST still re-checks offer + request status.
  await c.query(
    `update action_token set used_at = now() where request_id = $1 and purpose <> 'manage' and used_at is null`,
    [requestId],
  );
  return rowCount ?? 0;
}

/**
 * ENG-02: Jon locked a window another guest's live stand-by offer held (he gets the "It's withdrawn" line). Those
 * offers are withdrawn: released, their take links spent (they then show the current state), and the guest is back
 * in Needs a reply, as when an offer expires, so Jon can offer them the next freed window at once. No email.
 * Run after the lock commits, in its own transaction, in the lock order every offer action takes (the request row,
 * then its tokens and offers): inside the lock, which holds the week, it could wait on a take of that same offer
 * that is waiting on the week. Awaited before Jon's answer. Returns how many offers it withdrew.
 */
export async function withdrawStandbyOffers(offerIds: string[], now = new Date()): Promise<number> {
  if (offerIds.length === 0) return 0;
  return withTx(async (c) => {
    const { rows: reqs } = await c.query<{ id: string }>(
      `select r.id from request r
        where r.id in (select request_id from offer where id = any($1::uuid[]))
        order by r.id for update of r`,
      [offerIds],
    );
    const { rows: released } = await c.query<{ id: string; request_id: string }>(
      `update offer set released_at = $2
        where id = any($1::uuid[]) and kind = 'standby_open' and taken_at is null and released_at is null
        returning id, request_id`,
      [offerIds, now],
    );
    if (released.length === 0 || reqs.length === 0) return 0;
    await c.query(
      `update action_token set used_at = $2 where offer_id = any($1::uuid[]) and purpose <> 'manage' and used_at is null`,
      [released.map((o) => o.id), now],
    );
    await c.query(
      `update request set awaiting_jon_since = coalesce(awaiting_jon_since, $2)
        where id = any($1::uuid[]) and status in ('requested', 'needs_new_time', 'standby')`,
      [released.map((o) => o.request_id), now],
    );
    return released.length;
  });
}

// T2.4.01 (lane L1): creating offers. The email carries a LINK SPEC (link-vars.ts 'take' / 'pick'), and its
// single-use take_offer / pick_new_date token is minted when that email is sent, expiring with the offer.
export type OfferKind = 'suggested_times' | 'standby_open' | 'weather_call';
/** One offered range (dates mode, §6 offer.ranges). */
export interface OfferRange {
  startsAt: Date;
  endsAt: Date;
  where: string | null;
}
/** Suggest another time: up to 4 open windows or up to 4 ranges (TSD T2.4). */
export const MAX_OFFER_OPTIONS = 4;
/** §6: only a stand-by offer expires, 48 hours after it's made. */
export const STANDBY_OFFER_HOURS = 48;

export interface CreateOfferInput {
  requestId: string;
  kind: OfferKind;
  slotIds?: string[];
  ranges?: OfferRange[];
  expiresAt?: Date | null;
}

/** offer.ranges as stored (and compared): ISO instants, in the order given. */
function rangesJson(ranges: OfferRange[]): string {
  return JSON.stringify(
    ranges.map((r) => ({
      starts_at: r.startsAt.toISOString(),
      ends_at: r.endsAt.toISOString(),
      where: r.where,
    })),
  );
}

/** A double submit (pr46-review L5): the request's live offer of this kind with exactly these windows, if any. */
export async function sameLiveOffer(
  c: PoolClient,
  requestId: string,
  kind: OfferKind,
  o: { slotIds?: string[]; ranges?: OfferRange[] },
): Promise<string | null> {
  const { rows } = await c.query<{ id: string }>(
    `select id from offer
      where request_id = $1 and kind = $2 and taken_at is null and released_at is null
        and slot_ids @> $3::uuid[] and slot_ids <@ $3::uuid[] and ranges = $4::jsonb
      limit 1`,
    [requestId, kind, o.slotIds ?? [], rangesJson(o.ranges ?? [])],
  );
  return rows[0]?.id ?? null;
}

/** Inside the caller's transaction. Returns the offer id (the E5/E7/E10 event key and link spec). */
export async function createOffer(c: PoolClient, a: CreateOfferInput): Promise<string> {
  const slotIds = a.slotIds ?? [];
  const ranges = a.ranges ?? [];
  if (slotIds.length + ranges.length > MAX_OFFER_OPTIONS || (slotIds.length && ranges.length)) {
    throw new RangeError('an offer is up to 4 windows, or up to 4 ranges');
  }
  const { rows } = await c.query<{ id: string }>(
    `insert into offer (request_id, kind, slot_ids, ranges, expires_at) values ($1, $2, $3, $4, $5) returning id`,
    [a.requestId, a.kind, slotIds, rangesJson(ranges), a.expiresAt ?? null],
  );
  return rows[0]!.id;
}

export interface LiveOffer {
  id: string;
  request_id: string;
  kind: OfferKind;
  slot_ids: string[];
  ranges: { starts_at: string; ends_at: string; where?: string | null }[];
  expires_at: Date | null;
}

/** The offer, if it can still be taken: not taken, not released, not past its expiry. Locks the row. */
export async function liveOfferForUpdate(
  c: PoolClient,
  offerId: string,
  now: Date,
): Promise<LiveOffer | null> {
  const { rows } = await c.query<LiveOffer>(
    `select id, request_id, kind, slot_ids, ranges, expires_at from offer
      where id = $1 and taken_at is null and released_at is null and (expires_at is null or expires_at > $2)
        for update`,
    [offerId, now],
  );
  return rows[0] ?? null;
}
