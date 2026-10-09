// src/features/requests/suggest.ts — T2.4.02 Jon's "Suggest another time" (§6: `requested` / `standby` /
// `needs_new_time` → `needs_new_time`, including a re-suggest): up to 4 open windows (slots mode) or up to 4 ranges
// (dates mode). One transaction: the request row FOR UPDATE, the old live offers released (a re-suggest replaces
// them), a `suggested_times` offer (no expiry), the audit row and the pending E5 with ONE take link (a link spec,
// minted at send time). After commit the email is sent, awaited. A time outside the season or shut by a block is
// refused here (the engine's blockedBy); whether a window is still free is decided when the guest takes it
// (canLock, T2.4.07).
import 'server-only';
import type { PoolClient } from 'pg';
import { dishBySlug, dishInSentence } from '@/content/menu-helpers';
import { loadEngineData } from '@/features/availability/load';
import { blockedBy, inSeason, windowFitsDish } from '@/features/availability/rules';
import type { CountsToward, RequestStatus, WindowKind } from '@/features/availability/types';
import { takeLink } from '@/features/email/link-vars';
import { queueEmail } from '@/features/email/send';
import { withTx } from '@/lib/db';
import { vancouverDate } from '@/lib/time';
import { guestWhen } from '@/lib/when';
import { createOffer, releaseLiveOffers, sameLiveOffer, type OfferRange } from './offers';
import { noSideEffects, queuedId, runAfterCommit, type AfterCommit } from './side-effects';

export type SuggestOptions = { slotIds: string[] } | { ranges: OfferRange[] };

/** Every T2.4 admin action: the new offer's id when it made one; a refusal carries a code for the sheet. */
export type OfferActionResult =
  | { ok: true; offerId?: string }
  | { ok: false; status: 404; reason: 'request_not_found' | 'slot_not_found' }
  | { ok: false; status: 409; reason: string };

export const SUGGESTABLE = new Set(['requested', 'standby', 'needs_new_time']);

export interface RequestForOffer {
  status: RequestStatus;
  dish: string;
  contact_email: string;
  guest_time_zone: string | null;
  joined_to_request_id: string | null;
  counts_toward: CountsToward;
}

/** The request row, locked (every offer action changes its status or holds a window for it). */
export async function requestForOffer(c: PoolClient, requestId: string): Promise<RequestForOffer | null> {
  const { rows } = await c.query<RequestForOffer>(
    `select status, dish, contact_email::text as contact_email, guest_time_zone, joined_to_request_id, counts_toward
       from request where id = $1 for update`,
    [requestId],
  );
  return rows[0] ?? null;
}

export interface OfferedTime {
  startsAt: Date;
  endsAt: Date;
}

/**
 * The offered times, earliest first, or a refusal: an unknown slot, a time that has already started, or (CR-05) a
 * slot whose window the request's dish can't use (no lunch for The First Round, no slot for a dates-only dish). The
 * guest's take would refuse that one anyway (canLock rule 2(i)); refusing it here means it is never emailed.
 */
export async function offeredTimes(
  c: PoolClient,
  o: SuggestOptions,
  dish: string,
  now: Date,
): Promise<OfferedTime[] | 'slot_not_found' | 'in_the_past' | 'not_for_this_dish'> {
  let times: OfferedTime[];
  if ('slotIds' in o) {
    const { rows } = await c.query<{ starts_at: Date; ends_at: Date; window_kind: WindowKind }>(
      `select starts_at, ends_at, window_kind from slot where id = any($1::uuid[]) order by starts_at`,
      [o.slotIds],
    );
    if (rows.length !== new Set(o.slotIds).size) return 'slot_not_found';
    if (rows.some((r) => !windowFitsDish(dishBySlug(dish), r.window_kind))) return 'not_for_this_dish';
    times = rows.map((r) => ({ startsAt: r.starts_at, endsAt: r.ends_at }));
  } else {
    times = o.ranges
      .map((r) => ({ startsAt: r.startsAt, endsAt: r.endsAt }))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }
  return times.some((t) => t.startsAt <= now) ? 'in_the_past' : times;
}

/** An offered time in an email (E5, E5b, E7): as the site writes it, with the guest's own zone (QA C). */
export function timeLabel(t: OfferedTime, guestTimeZone: string | null): string {
  return guestWhen(t.startsAt, t.endsAt, guestTimeZone);
}

export async function audit(
  c: PoolClient,
  requestId: string,
  action: string,
  detail: Record<string, unknown>,
  actor: 'jon' | 'guest' | 'system' = 'jon',
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into audit_log (actor, action, request_id, detail) values ($1, $2, $3, $4) returning id`,
    [actor, action, requestId, JSON.stringify(detail)],
  );
  return rows[0]!.id;
}

async function suggestTx(
  c: PoolClient,
  a: { requestId: string; options: SuggestOptions; lead: string; now: Date },
): Promise<{ result: OfferActionResult; after: AfterCommit }> {
  const none = noSideEffects();
  const r = await requestForOffer(c, a.requestId);
  if (!r) return { result: { ok: false, status: 404, reason: 'request_not_found' }, after: none };
  if (!SUGGESTABLE.has(r.status) || r.joined_to_request_id) {
    return { result: { ok: false, status: 409, reason: 'not_allowed' }, after: none };
  }
  const times = await offeredTimes(c, a.options, r.dish, a.now);
  if (times === 'slot_not_found') return { result: { ok: false, status: 404, reason: times }, after: none };
  if (typeof times === 'string') return { result: { ok: false, status: 409, reason: times }, after: none };
  // The season and the one block rule (blockedBy, as a lock checks them): a time Jon has shut, or one outside
  // the season, is never offered (the guest's take would only say "Looks like that one went"). Still free or not
  // is the take's to decide.
  const loaded = await loadEngineData(a.now, c);
  if (times.some((t) => !inSeason(vancouverDate(t.startsAt), loaded.settings)))
    return { result: { ok: false, status: 409, reason: 'out_of_season' }, after: none };
  if (times.some((t) => blockedBy({ range: t }, loaded.blocks, loaded.settings)))
    return { result: { ok: false, status: 409, reason: 'in_block' }, after: none };

  // A double submit acts once: the same windows already on offer keep their offer and their one E5.
  const same =
    r.status === 'needs_new_time' && (await sameLiveOffer(c, a.requestId, 'suggested_times', a.options));
  if (same) return { result: { ok: true, offerId: same }, after: none };

  await releaseLiveOffers(c, a.requestId);
  const offerId = await createOffer(c, { requestId: a.requestId, kind: 'suggested_times', ...a.options });
  await c.query(`update request set status = 'needs_new_time', awaiting_jon_since = null where id = $1`, [
    a.requestId,
  ]);
  await audit(c, a.requestId, 'times_suggested', {
    from_status: r.status,
    to_status: 'needs_new_time',
    offer_id: offerId,
  });
  const after = noSideEffects();
  after.emailIds.push(
    ...queuedId(
      await queueEmail(c, {
        template: 'E5',
        to: r.contact_email,
        requestId: a.requestId,
        eventKey: offerId,
        vars: {
          dish: dishInSentence(r.dish),
          lead: a.lead ? `${a.lead} ` : '',
          times: times.map((t) => timeLabel(t, r.guest_time_zone)).join('\n'),
          takeLink: takeLink(offerId),
        },
      }),
    ),
  );
  return { result: { ok: true, offerId }, after };
}

export async function suggestTimes(
  requestId: string,
  options: SuggestOptions,
  lead = '',
  now = new Date(),
): Promise<OfferActionResult> {
  const { result, after } = await withTx((c) => suggestTx(c, { requestId, options, lead, now }));
  await runAfterCommit(after, 'suggest');
  return result;
}
