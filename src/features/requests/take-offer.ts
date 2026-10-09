// src/features/requests/take-offer.ts — T2.4.07 the guest takes an offered time (S18 POST; the GET page is L3's
// loadOfferModel, which never writes). One transaction, in the lock order request → action_token → offer (the same
// order as a cancel, re-request or supersede, which lock the request and then spend its tokens; pr46-review M1): read
// the token (no lock) for its request, lock the request row, spend the single-use take_offer token (`update … where
// used_at is null returning`: exactly one caller wins), lock the offer row, then the T2.3 lock path (the week row,
// the engine read, canLock). A pass locks it in, marks the offer taken and releases the rest;
// E4 and the calendar create run after commit, awaited.
// A refusal (the time went, the week filled, another guest's stand-by offer holds it) un-spends the token, so an
// other offered time can still be taken, and sets `awaiting_jon_since` (§6: the request shows in Needs a reply).
// The answer lists the offered times that are still open, or "Looks like that one went." (§14.4 S18).
// Taking twice acts once: the second POST finds the token spent and answers with the current state (AC1).
import 'server-only';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { canLock } from '@/features/availability/canLock';
import { dishBySlug } from '@/content/menu-helpers';
import { loadEngineData } from '@/features/availability/load';
import { slotCountsToward } from '@/features/availability/rules';
import type { CountsToward, RequestStatus } from '@/features/availability/types';
import { consumeToken, findToken } from '@/features/invites/action-tokens';
import { q, withTx } from '@/lib/db';
import { honeypotField } from '@/lib/honeypot';
import {
  afterLock,
  isRangeTaken,
  lockWithin,
  recordTakeHoneypot,
  type LockTarget,
  type LockTxOutcome,
} from './lock';
import { liveOfferForUpdate } from './offers';

export const TakeBody = z.union([
  z.strictObject({ token: z.string().max(100), slotId: z.uuid(), hp: honeypotField }),
  z.strictObject({
    token: z.string().max(100),
    rangeIndex: z.number().int().min(0).max(3),
    hp: honeypotField,
  }),
]);
export type TakeBody = z.infer<typeof TakeBody>;

/** 'done': locked just now, or a second visit (the route answers with the current state, AC1). 'refused': the
 * route answers with the other offered times still open (stillOpen), or "Looks like that one went." */
export type TakeResult = 'done' | 'refused' | 'invalid';

/** An offered time as the S18 page model lists it (L3's manage-model OfferWindow). */
export interface OfferedTime {
  slotId: string | null;
  startsAt: Date;
  endsAt: Date;
}

/** Rolls the transaction back (a wrong-purpose token, or a choice outside the offer). */
class Abort extends Error {}

type TxOut = { kind: 'spent' } | { kind: 'locked'; out: LockTxOutcome } | { kind: 'refused' };

/** §6: "Offer take fails canLock" → the request shows in Needs a reply (an earlier wait keeps its start). */
const FLAG_FOR_JON = `update request set awaiting_jon_since = coalesce(awaiting_jon_since, $2)
  where id = $1 and status in ('requested', 'needs_new_time', 'standby')`;

async function takeTx(c: PoolClient, b: TakeBody, honeypot: boolean, now: Date): Promise<TxOut> {
  const found = await findToken(b.token, c); // read only: which request to lock first
  if (!found) return { kind: 'spent' };
  // Lock order everywhere: the request row, then its tokens, then its offers.
  await c.query(`select r.id from request r where r.id = $1 for update`, [found.request_id]);
  const t = await consumeToken(c, b.token);
  if (!t) return { kind: 'spent' };
  if (t.purpose !== 'take_offer' || !t.offer_id) throw new Abort(); // rolled back: not spent
  const offer = await liveOfferForUpdate(c, t.offer_id, now);
  if (!offer) return { kind: 'spent' }; // released (re-suggested, cancelled) or expired: the current state
  let target: LockTarget;
  if ('slotId' in b) {
    if (!offer.slot_ids.includes(b.slotId)) throw new Abort();
    target = { slotId: b.slotId };
  } else {
    const r = offer.ranges[b.rangeIndex];
    if (!r) throw new Abort();
    target = { startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at), where: r.where ?? null };
  }
  const takenOffer = { offerId: offer.id, honeypot };
  const out = await lockWithin(
    c,
    { requestId: t.request_id, target, mode: 'lock', takenOffer, windowRule: windowRuleFor(offer.kind), now },
    now,
  );
  if (out.ok) return { kind: 'locked', out };
  // The token stays usable for the other offered times.
  await c.query(`update action_token set used_at = null where id = $1`, [t.id]);
  await c.query(FLAG_FOR_JON, [t.request_id, now]);
  if (honeypot) await recordTakeHoneypot(c, t.request_id, offer.id); // AD-9: kept on a refusal too (L2)
  return { kind: 'refused' };
}

/** `honeypot`: the shared field was filled (AD-9): recorded in the audit row, never refused. */
export async function takeOffer(b: TakeBody, honeypot = false, now = new Date()): Promise<TakeResult> {
  let out: TxOut;
  try {
    out = await withTx((c) => takeTx(c, b, honeypot, now));
  } catch (e) {
    if (e instanceof Abort) return 'invalid';
    // A range locked in another week that overlaps (the database's own guard): the same refusal (rolled back,
    // so the token is still unspent).
    if (!isRangeTaken(e)) throw e;
    const t = await findToken(b.token);
    if (t) await q(FLAG_FOR_JON, [t.request_id, now]);
    return 'refused';
  }
  if (out.kind === 'locked') await afterLock(out.out);
  return out.kind === 'refused' ? 'refused' : 'done';
}

/**
 * CR-05: a suggested time (Suggest another time, a block's move) must fit the dish; only a stand-by offer can hold
 * a window the dish doesn't use (Jon's L13 Override, checked when he made the offer).
 */
function windowRuleFor(offerKind: string): boolean {
  return offerKind !== 'standby_open';
}

/** The offered times canLock would still pass for this guest right now (read-only; a take re-checks). The one
 * just refused fails it too, so it drops out on its own. */
export async function stillOpen<W extends OfferedTime>(
  requestId: string,
  windows: W[],
  offerKind: string,
  now = new Date(),
): Promise<W[]> {
  if (windows.length === 0) return [];
  const [r] = await q<{ status: RequestStatus; counts_toward: CountsToward; dish: string }>(
    `select status, counts_toward, dish from request where id = $1`,
    [requestId],
  );
  if (!r) return [];
  const loaded = await loadEngineData(now);
  const slots = new Map(loaded.slots.map((s) => [s.id, s]));
  return windows.filter((w) => {
    const slot = w.slotId ? slots.get(w.slotId) : undefined;
    if (w.slotId && !slot) return false;
    const v = canLock({
      now,
      request: {
        id: requestId,
        status: r.status,
        countsToward: slot ? slotCountsToward(dishBySlug(r.dish)) : r.counts_toward, // as the take locks it (CR-01)
        dish: r.dish,
      },
      mode: 'lock',
      target: slot ? { slot } : { range: { startsAt: w.startsAt, endsAt: w.endsAt } },
      bookings: loaded.bookings,
      blocks: loaded.blocks,
      weeks: loaded.weeks,
      offers: loaded.offers,
      settings: loaded.settings,
      windowRule: windowRuleFor(offerKind),
    });
    return v.ok && !v.warnings.includes('standby_offer_live');
  });
}
