// src/features/requests/pitch-weather.ts — T2.4.05 "About your pitch" (E8 the smaller version / E9 an honest no)
// and T2.4.06 the "Weather call" (E10 with a pick_new_date link), Jon's actions from A3.
// §6: About your pitch: `requested` / `standby` / `needs_new_time` → `needs_new_time`, `awaiting_jon_since` cleared.
// Weather call: `locked` → `needs_new_time`: the event is deleted through the calendar outbox (after commit), the
// request's range is cleared so the window frees at once, live offers are released, and a `weather_call` offer
// carries the guest's single-use pick_new_date link (minted at send time). Guests joined to the booking follow
// §6 rule 3 (pr51-review H1): the same E10, each with a pick link of their own (a pick token is bound to its
// offer's request), through L3's cascadeToJoined, BEFORE the host's range is cleared (H2: the joined rows keep a
// copy of it for Promote to host).
import 'server-only';
import type { PoolClient } from 'pg';
import { dishBySlug } from '@/content/menu-helpers';
import { queueIcsEmail } from '@/features/calendar/ics-email';
import { MANAGE_ANCHOR, manageLink, menuLink, pickLink } from '@/features/email/link-vars';
import { queueEmail } from '@/features/email/send';
import { reopenManageTokens } from '@/features/invites/action-tokens';
import { withTx } from '@/lib/db';
import { isLazilyDone } from './guest-cancel';
import { cascadeToJoined } from './joined-cascade';
import { createOffer, releaseLiveOffers } from './offers';
import { enqueueCalendar, noSideEffects, queuedId, runAfterCommit, type AfterCommit } from './side-effects';
import { audit, requestForOffer, SUGGESTABLE, type OfferActionResult } from './suggest';

type Outcome = { result: OfferActionResult; after: AfterCommit };
const notFound = (): Outcome => ({
  result: { ok: false, status: 404, reason: 'request_not_found' },
  after: noSideEffects(),
});
const refused = (reason: string): Outcome => ({
  result: { ok: false, status: 409, reason },
  after: noSideEffects(),
});

/** E8 carries Jon's words for how big the pitch is ("three days long"); E9 is the honest no. */
export type PitchReply = { reply: 'smaller'; length: string } | { reply: 'no' };

async function pitchTx(c: PoolClient, requestId: string, p: PitchReply): Promise<Outcome> {
  const r = await requestForOffer(c, requestId);
  if (!r) return notFound();
  if (dishBySlug(r.dish)?.flow !== 'pitch') return refused('not_a_pitch');
  if (!SUGGESTABLE.has(r.status) || r.joined_to_request_id) return refused('not_allowed');
  const action = p.reply === 'smaller' ? 'pitch_smaller' : 'pitch_no';
  // A double tap acts once (pr51-review M1): the same reply as the request's latest event is refused, no email.
  const [last] = (
    await c.query<{ action: string }>(
      `select action from audit_log where request_id = $1 order by at desc, id desc limit 1`,
      [requestId],
    )
  ).rows;
  if (last?.action === action) return refused('already_replied');
  // The pitch's live offers go (pr51-review M2): after an honest no, an old E5 link can't lock it.
  await releaseLiveOffers(c, requestId);
  await c.query(`update request set status = 'needs_new_time', awaiting_jon_since = null where id = $1`, [
    requestId,
  ]);
  const auditId = await audit(c, requestId, action, {
    from_status: r.status,
    to_status: 'needs_new_time',
  });
  const after = noSideEffects();
  after.emailIds.push(
    ...queuedId(
      await queueEmail(c, {
        template: p.reply === 'smaller' ? 'E8' : 'E9',
        to: r.contact_email,
        requestId,
        eventKey: auditId,
        vars:
          p.reply === 'smaller'
            ? { length: p.length, manageLink: manageLink(requestId, MANAGE_ANCHOR) } // EML-05: opens the pitch form
            : { menuLink: menuLink(requestId) },
      }),
    ),
  );
  return { result: { ok: true }, after };
}

/** T2.4.05. */
export async function replyToPitch(requestId: string, p: PitchReply): Promise<OfferActionResult> {
  const { result, after } = await withTx((c) => pitchTx(c, requestId, p));
  await runAfterCommit(after, 'pitch');
  return result;
}

async function weatherTx(c: PoolClient, requestId: string, now: Date): Promise<Outcome> {
  const r = await requestForOffer(c, requestId);
  if (!r) return notFound();
  const { rows } = await c.query<{ ends_at: Date | null; calendar_state: string }>(
    `select locked_ends_at as ends_at, calendar_state from request where id = $1`,
    [requestId],
  );
  // Only an upcoming booking of its own: a joined guest follows its host (Jon calls it on the host).
  if (
    r.status !== 'locked' ||
    r.joined_to_request_id ||
    isLazilyDone({ status: r.status, ends_at: rows[0]!.ends_at }, now)
  ) {
    return refused('not_allowed');
  }
  if (r.counts_toward !== 'big_day') return refused('not_a_big_day'); // C4: Weather call (Big Days only)
  await releaseLiveOffers(c, requestId);
  const offerId = await createOffer(c, { requestId, kind: 'weather_call' });
  const auditId = await audit(c, requestId, 'weather_call', {
    from_status: 'locked',
    to_status: 'needs_new_time',
    offer_id: offerId,
  });
  const after = noSideEffects();
  // Rule 3 first, while the host row still has its range: one weather_call offer per joined guest, then the cascade.
  const { rows: joined } = await c.query<{ id: string }>(
    `select j.id from request j where j.joined_to_request_id = $1 and j.status = 'locked'
      order by j.created_at, j.id for update`,
    [requestId],
  );
  const offerFor = new Map<string, string>();
  for (const j of joined) offerFor.set(j.id, await createOffer(c, { requestId: j.id, kind: 'weather_call' }));
  after.emailIds.push(
    ...(await cascadeToJoined(c, requestId, {
      template: 'E10',
      eventKey: auditId,
      now,
      toStatus: { status: 'needs_new_time', auditAction: 'weather_call' },
      vars: (j) => {
        const own = offerFor.get(j.id);
        if (!own) throw new Error('weather call: a joined guest without its offer'); // rolled back
        return { pickLink: pickLink(own) };
      },
    })),
  );
  // T3.4.05 (AD-6): a guest who got the .ics (not Google's invite) gets the .ics CANCEL, read while the range is set.
  if (rows[0]!.calendar_state === 'ics_sent') {
    after.emailIds.push(...(await queueIcsEmail(c, requestId, 'CANCEL')));
  }
  await c.query(
    `update request
        set status = 'needs_new_time', locked_slot_id = null, locked_starts_at = null, locked_ends_at = null,
            locked_where = null, awaiting_jon_since = null
      where id = $1`,
    [requestId],
  );
  // Back to waiting on a new time: the live manage links (host and joined guests) last the unlocked lifetime, not
  // the old end + 7 days, as after Ask for another time.
  await reopenManageTokens(c, [requestId, ...joined.map((j) => j.id)], now);
  after.outboxIds.push(await enqueueCalendar(c, 'calendar_delete', requestId));
  after.emailIds.push(
    ...queuedId(
      await queueEmail(c, {
        template: 'E10',
        to: r.contact_email,
        requestId,
        eventKey: offerId,
        vars: { pickLink: pickLink(offerId) },
      }),
    ),
  );
  return { result: { ok: true, offerId }, after };
}

/** T2.4.06. */
export async function weatherCall(requestId: string, now = new Date()): Promise<OfferActionResult> {
  const { result, after } = await withTx((c) => weatherTx(c, requestId, now));
  await runAfterCommit(after, 'weather_call');
  return result;
}
