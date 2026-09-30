// src/features/requests/suggest.ts — T2.4.02 Jon's "Suggest another time" (§6: `requested` / `standby` /
// `needs_new_time` → `needs_new_time`, including a re-suggest): up to 4 open windows (slots mode) or up to 4 ranges
// (dates mode). One transaction: the request row FOR UPDATE, the old live offers released (a re-suggest replaces
// them), a `suggested_times` offer (no expiry), the audit row and the pending E5 with ONE take link (a link spec,
// minted at send time). After commit the email is sent, awaited. Whether a window is still free is decided when
// the guest takes it (canLock, T2.4.07), never here.
import 'server-only';
import type { PoolClient } from 'pg';
import { dishBySlug } from '@/content/menu-helpers';
import type { CountsToward, RequestStatus } from '@/features/availability/types';
import { takeLink } from '@/features/email/link-vars';
import { queueEmail } from '@/features/email/send';
import { withTx } from '@/lib/db';
import { dayLabel, formatGuestTime } from '@/lib/time';
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

/** The offered starts, earliest first, or a refusal (an unknown slot, or a time that has already started). */
export async function offeredStarts(
  c: PoolClient,
  o: SuggestOptions,
  now: Date,
): Promise<Date[] | 'slot_not_found' | 'in_the_past'> {
  let starts: Date[];
  if ('slotIds' in o) {
    const { rows } = await c.query<{ starts_at: Date }>(
      `select starts_at from slot where id = any($1::uuid[]) order by starts_at`,
      [o.slotIds],
    );
    if (rows.length !== new Set(o.slotIds).size) return 'slot_not_found';
    starts = rows.map((r) => r.starts_at);
  } else {
    starts = o.ranges.map((r) => r.startsAt).sort((a, b) => a.getTime() - b.getTime());
  }
  return starts.some((s) => s <= now) ? 'in_the_past' : starts;
}

export function timeLabel(startsAt: Date, guestTimeZone: string | null): string {
  return `${dayLabel(startsAt)}, ${formatGuestTime(startsAt, guestTimeZone)}`;
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
  const starts = await offeredStarts(c, a.options, a.now);
  if (starts === 'slot_not_found') return { result: { ok: false, status: 404, reason: starts }, after: none };
  if (starts === 'in_the_past') return { result: { ok: false, status: 409, reason: starts }, after: none };

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
          dish: dishBySlug(r.dish)?.name ?? r.dish,
          lead: a.lead ? `${a.lead} ` : '',
          times: starts.map((s) => timeLabel(s, r.guest_time_zone)).join('\n'),
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
