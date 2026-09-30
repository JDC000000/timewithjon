// src/features/requests/standby.ts — T2.4.03 Jon's "Move to stand-by" (E6) and T2.4.04 "Offer a freed window to
// one stand-by guest" (E7), plus T2.4.09 the 48-hour expiry of those offers.
// §6: `requested` / `needs_new_time` → `standby` (E6; `awaiting_jon_since` cleared). A stand-by offer is a
// `standby_open` offer that lives 48 hours; while it lives the engine hides its window from everyone else (C3
// 2(f)). L13: only a window that fits the guest's dish can be offered, unless Jon ticks Override. AC2: two stand-by
// guests can't hold a live offer on the same window: the week row is locked FOR UPDATE (as a lock does) before the
// live offers are read, so two offers in one week are serialised. Expiry, cancel or lock releases the offer; on
// expiry the request goes back to Needs a reply, with no email.
import 'server-only';
import type { PoolClient } from 'pg';
import { dishBySlug } from '@/content/menu-helpers';
import { canLock } from '@/features/availability/canLock';
import { loadEngineData } from '@/features/availability/load';
import type { Slot } from '@/features/availability/types';
import { takeLink } from '@/features/email/link-vars';
import { queueEmail } from '@/features/email/send';
import { withTx } from '@/lib/db';
import { formatInTimeZone } from 'date-fns-tz';
import { addDays, TZ, vancouverDate, weekStartOf } from '@/lib/time';
import { standbyWeekLabel } from './intake-emails';
import { lockWeekOf } from './lock';
import { createOffer, STANDBY_OFFER_HOURS, type OfferRange } from './offers';
import { noSideEffects, queuedId, runAfterCommit, type AfterCommit } from './side-effects';
import { audit, requestForOffer, timeLabel, type OfferActionResult } from './suggest';

const HOUR_MS = 3600 * 1000;

type StandbyResult = OfferActionResult;

async function moveTx(
  c: PoolClient,
  a: { requestId: string; weekStart: string; now: Date },
): Promise<{ result: StandbyResult; after: AfterCommit }> {
  const none = noSideEffects();
  const r = await requestForOffer(c, a.requestId);
  if (!r) return { result: { ok: false, status: 404, reason: 'request_not_found' }, after: none };
  if (!['requested', 'needs_new_time'].includes(r.status) || r.joined_to_request_id) {
    return { result: { ok: false, status: 409, reason: 'not_allowed' }, after: none };
  }
  const week = await c.query(`select 1 from week where week_start = $1`, [a.weekStart]);
  if (!week.rowCount) return { result: { ok: false, status: 409, reason: 'out_of_season' }, after: none };
  // C3 rule 12: no stand-by for a week that has ended (its Friday is past).
  if (addDays(a.weekStart, 4) < vancouverDate(a.now)) {
    return { result: { ok: false, status: 409, reason: 'in_the_past' }, after: none };
  }
  await c.query(
    `update request set status = 'standby', standby_week = $2, awaiting_jon_since = null where id = $1`,
    [a.requestId, a.weekStart],
  );
  const auditId = await audit(c, a.requestId, 'moved_to_standby', {
    from_status: r.status,
    to_status: 'standby',
  });
  const after = noSideEffects();
  after.emailIds.push(
    ...queuedId(
      await queueEmail(c, {
        template: 'E6',
        to: r.contact_email,
        requestId: a.requestId,
        eventKey: auditId,
        vars: { week: standbyWeekLabel(a.weekStart) },
      }),
    ),
  );
  return { result: { ok: true }, after };
}

/** T2.4.03. `week` is any date in the stand-by week (stored as its Monday). */
export async function moveToStandby(
  requestId: string,
  week: string,
  now = new Date(),
): Promise<StandbyResult> {
  const { result, after } = await withTx((c) => moveTx(c, { requestId, weekStart: weekStartOf(week), now }));
  await runAfterCommit(after, 'standby');
  return result;
}

export type StandbyWindow = { slotId: string } | OfferRange;

async function offerTx(
  c: PoolClient,
  a: { requestId: string; window: StandbyWindow; override: boolean; now: Date },
): Promise<{ result: StandbyResult; after: AfterCommit }> {
  const none = noSideEffects();
  const refuse = (reason: string): { result: StandbyResult; after: AfterCommit } => ({
    result: { ok: false, status: 409, reason },
    after: none,
  });
  const r = await requestForOffer(c, a.requestId);
  if (!r) return { result: { ok: false, status: 404, reason: 'request_not_found' }, after: none };
  if (r.status !== 'standby' || r.joined_to_request_id) return refuse('not_allowed');
  // One freed window to one stand-by guest at a time (pr49-review L-2): a second while one lives is refused.
  const live = await c.query(
    `select 1 from offer where request_id = $1 and kind = 'standby_open' and taken_at is null
        and released_at is null and expires_at > $2`,
    [a.requestId, a.now],
  );
  if (live.rowCount) return refuse('offer_live');
  const dish = dishBySlug(r.dish);

  let slot: Slot | null = null;
  if ('slotId' in a.window) {
    const { rows } = await c.query<{
      id: string;
      date: string;
      window_kind: Slot['windowKind'];
      starts_at: Date;
      ends_at: Date;
    }>(`select id, date::text, window_kind, starts_at, ends_at from slot where id = $1`, [a.window.slotId]);
    const s = rows[0];
    if (!s) return { result: { ok: false, status: 404, reason: 'slot_not_found' }, after: none };
    slot = { id: s.id, date: s.date, windowKind: s.window_kind, startsAt: s.starts_at, endsAt: s.ends_at };
  }
  const range = slot ? { startsAt: slot.startsAt, endsAt: slot.endsAt } : (a.window as OfferRange);
  // L13: a lunch can't go to a First Round guest; a dates-mode dish takes a range (Override skips this).
  const fits = slot ? Boolean(dish?.windows.includes(slot.windowKind)) : dish?.mode === 'dates';
  if (!fits && !a.override) return refuse('not_for_this_dish');

  // Serialise with every other offer and lock in the week, then read what holds the window (AC2).
  await lockWeekOf(c, range.startsAt);
  const loaded = await loadEngineData(a.now, c);
  const verdict = canLock({
    now: a.now,
    request: { id: a.requestId, status: r.status, countsToward: r.counts_toward, dish: r.dish },
    mode: 'lock',
    target: slot ? { slot } : { range },
    bookings: loaded.bookings,
    blocks: loaded.blocks,
    weeks: loaded.weeks,
    offers: loaded.offers,
    settings: loaded.settings,
  });
  if (!verdict.ok) return refuse(verdict.reason);
  if (verdict.warnings.includes('standby_offer_live')) return refuse('held_by_offer');

  const offerId = await createOffer(c, {
    requestId: a.requestId,
    kind: 'standby_open',
    ...(slot ? { slotIds: [slot.id] } : { ranges: [a.window as OfferRange] }),
    expiresAt: new Date(a.now.getTime() + STANDBY_OFFER_HOURS * HOUR_MS),
  });
  await c.query(`update request set awaiting_jon_since = null where id = $1`, [a.requestId]);
  await audit(c, a.requestId, 'standby_offered', {
    offer_id: offerId,
    slot_id: slot?.id ?? null,
    ...(a.override && !fits ? { override: ['dish'] } : {}),
  });
  const after = noSideEffects();
  after.emailIds.push(
    ...queuedId(
      await queueEmail(c, {
        template: 'E7',
        to: r.contact_email,
        requestId: a.requestId,
        eventKey: offerId,
        vars: {
          weekday: weekdayName(range.startsAt),
          when: timeLabel(range.startsAt, r.guest_time_zone),
          takeLink: takeLink(offerId),
        },
      }),
    ),
  );
  return { result: { ok: true, offerId }, after };
}

/** "Thursday": the real weekday of the window in Vancouver (E7's subject). */
export function weekdayName(instant: Date): string {
  return formatInTimeZone(instant, TZ, 'EEEE');
}

/** T2.4.04. */
export async function offerStandbyWindow(
  requestId: string,
  window: StandbyWindow,
  override = false,
  now = new Date(),
): Promise<StandbyResult> {
  const { result, after } = await withTx((c) => offerTx(c, { requestId, window, override, now }));
  await runAfterCommit(after, 'standby_offer');
  return result;
}

/** Stand-by offers past their 48 hours, released per tick batch (pr49-review L-1). */
export const EXPIRY_BATCH = 100;

/**
 * T2.4.09: stand-by offers past their 48 hours are released, and their requests go back to Needs a reply (an
 * earlier wait keeps its start). No email. The engine already ignores them lazily (T0.5 AC18); this makes it
 * visible to Jon. One batch; returns how many requests it handled.
 * Lock order as everywhere (pr49-review M-1): the request rows first (SKIP LOCKED: a request a take, cancel or
 * suggest holds right now goes to the next tick), then their offers, then the offers' tokens.
 */
export async function expireStandbyOffers(now = new Date(), limit = EXPIRY_BATCH): Promise<number> {
  return withTx(async (c) => {
    const { rows: reqs } = await c.query<{ id: string }>(
      `select r.id from request r
        where r.id in (select o.request_id from offer o
                        where o.kind = 'standby_open' and o.taken_at is null and o.released_at is null
                          and o.expires_at <= $1)
        order by r.id limit $2 for update of r skip locked`,
      [now, limit],
    );
    if (reqs.length === 0) return 0;
    const ids = reqs.map((r) => r.id);
    const { rows: offers } = await c.query<{ id: string }>(
      `update offer set released_at = $2
        where request_id = any($1::uuid[]) and kind = 'standby_open' and taken_at is null and released_at is null
          and expires_at <= $2
        returning id`,
      [ids, now],
    );
    // As every release does (pr32 L4): the offer's single-use links now show the state.
    await c.query(
      `update action_token set used_at = $2
        where id in (select id from action_token where offer_id = any($1::uuid[]) and purpose <> 'manage'
                       and used_at is null for update skip locked)`,
      [offers.map((o) => o.id), now],
    );
    await c.query(
      `update request set awaiting_jon_since = coalesce(awaiting_jon_since, $2)
        where id = any($1::uuid[]) and status in ('requested', 'needs_new_time', 'standby')`,
      [ids, now],
    );
    return reqs.length;
  });
}

/** The tick job: batches until none are left or the tick's budget is spent. */
export async function expireAllStandbyOffers(
  now: Date,
  deadline: number,
  batch = EXPIRY_BATCH,
): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await expireStandbyOffers(now, batch);
    total += n;
    if (n < batch || Date.now() >= deadline) return total;
  }
}
