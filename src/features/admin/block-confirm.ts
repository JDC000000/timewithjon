// src/features/admin/block-confirm.ts — T2.5.02 (TSD T2.5 AC3, §6 `locked` → `needs_new_time`): Jon confirms a
// block or away range over locked bookings. block() refused it with the affected list (the preview); Jon picked,
// per booking, fresh times to offer or none, and confirms here. One transaction:
//   - lock order (pr59 L3), the same as lock.ts: the request rows first (FOR UPDATE, by id), then
//     block()'s week locks. Nothing here waits on a request row while holding a week, so no 40P01 with a lock;
//   - under both, the affected set is re-read; if a booking was locked, moved or cancelled since the preview
//     (a guest cancel or a lock that committed while we waited: pr59 H1), nothing happens and the new list
//     comes back (409 locked_bookings), so Jon confirms what is really there;
//   - an offered time inside the block being added, or any other block, is refused (409 in_block, pr59 M1): the
//     guest's tap would fail at canLock;
//   - an identical block (same dates and kind) already there is reused, not added twice (pr59 L2);
//   - the block row is added;
//   - each booking goes to needs_new_time with its range cleared (the window frees at once), its live offers
//     released, Jon's offer created (suggested_times, no expiry) or none, an audit row, a calendar_delete outbox
//     row, and E5b: with the offer's times and ONE take link, or with no times (then it waits on Jon:
//     awaiting_jon_since is set, so it's in Needs a reply);
//   - rule 3: its joined guests follow it to needs_new_time (awaiting Jon, a copy of its range kept for Promote to
//     host) with E5b with no times and no link: the offer is the host's (cascadeToJoined, #52, under the host row
//     lock and before the range is cleared). No .ics of their own: the host's calendar_delete drops them.
// After commit the calendar rows and emails run, awaited (AD-1, L-3); a failure stays for the tick jobs.
import 'server-only';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { E5B_PARTS } from '@/content/emails';
import { queueIcsEmail } from '@/features/calendar/ics-email';
import { takeLink } from '@/features/email/link-vars';
import { queueEmail } from '@/features/email/send';
import { RangeFields } from '@/features/requests/lock-api';
import { cascadeToJoined, dishName } from '@/features/requests/joined-cascade';
import { rangesFrom } from '@/features/requests/offer-api';
import { createOffer, MAX_OFFER_OPTIONS, releaseLiveOffers } from '@/features/requests/offers';
import {
  enqueueCalendar,
  noSideEffects,
  queuedId,
  runAfterCommit,
  type AfterCommit,
} from '@/features/requests/side-effects';
import {
  audit as auditRequest,
  offeredStarts,
  requestForOffer,
  timeLabel,
  type SuggestOptions,
} from '@/features/requests/suggest';
import { withTx } from '@/lib/db';
import { datesTouched } from '@/lib/time';
import {
  type AffectedBooking,
  BlockBody,
  type BlockInput,
  insertBlock,
  lockBlockRange,
  lockedBookingsIn,
  type SeasonResult,
  underWayBookingsIn,
} from './season';

const BookingChoice = z.union([
  z.strictObject({ requestId: z.uuid() }), // E5b with no times
  z.strictObject({
    requestId: z.uuid(),
    slotIds: z
      .array(z.uuid())
      .min(1)
      .max(MAX_OFFER_OPTIONS)
      .refine((a) => new Set(a).size === a.length, 'duplicate slot'),
  }),
  z.strictObject({
    requestId: z.uuid(),
    ranges: z.array(z.strictObject(RangeFields)).min(1).max(MAX_OFFER_OPTIONS),
  }),
]);
/** The block Jon previewed, and one choice per affected booking (exactly the preview's bookings). */
export const ConfirmBlockBody = z.strictObject({
  block: BlockBody,
  bookings: z
    .array(BookingChoice)
    .max(100)
    .refine((b) => new Set(b.map((x) => x.requestId)).size === b.length, 'duplicate booking'),
});
export type ConfirmBlockInput = Omit<z.infer<typeof ConfirmBlockBody>, 'block'> & { block: BlockInput };

export type ConfirmBlockResult =
  | SeasonResult<{ id: string; moved: string[]; underWay: AffectedBooking[] }>
  | { ok: false; status: 404; reason: 'slot_not_found' }
  | { ok: false; status: 409; reason: 'in_the_past' | 'in_block' };

/** A booking's choice as offer options, or null for none; undefined when a range isn't a real Vancouver time. */
function optionsOf(b: ConfirmBlockInput['bookings'][number]): SuggestOptions | null | undefined {
  if ('slotIds' in b) return { slotIds: b.slotIds };
  if ('ranges' in b) {
    const ranges = rangesFrom(b.ranges);
    return ranges ? { ranges } : undefined;
  }
  return null;
}

/** Exported for the belt test (tests/int/admin-block-confirm-belt.int.test.ts); callers use confirmBlock. */
export async function moveBooking(
  c: PoolClient,
  requestId: string,
  options: SuggestOptions | null,
  starts: Date[],
  now: Date,
  after: AfterCommit,
): Promise<void> {
  const r = await requestForOffer(c, requestId); // row-locked since lockCandidates
  // Belt for pr59 H1: a status change under our row lock is impossible, so this throws (rolling everything back).
  if (r?.status !== 'locked') throw new Error(`block_confirm: booking ${requestId} changed under the lock`);
  const dish = dishName(r.dish);
  await releaseLiveOffers(c, requestId);
  const offerId = options ? await createOffer(c, { requestId, kind: 'suggested_times', ...options }) : null;
  const auditId = await auditRequest(c, requestId, 'blocked_over', {
    from_status: 'locked',
    to_status: 'needs_new_time',
    ...(offerId ? { offer_id: offerId } : {}),
  });
  // Rule 3, while the host still has its range (the joined rows keep a copy of it for Promote to host).
  after.emailIds.push(
    ...(await cascadeToJoined(c, requestId, {
      template: 'E5b',
      eventKey: auditId,
      now,
      toStatus: { status: 'needs_new_time', auditAction: 'blocked_over' },
      vars: (j) => ({ dish: dishName(j.dish), openTimes: E5B_PARTS.noTimes, takeLink: '' }),
    })),
  );
  // T3.4.05 (AD-6): the guest has the .ics, not Google's invite, so the .ics CANCEL takes it off their calendar.
  // Read before the locked time is cleared below.
  const { rows: cal } = await c.query<{ calendar_state: string }>(
    `select r.calendar_state::text from request r where r.id = $1`,
    [requestId],
  );
  if (cal[0]?.calendar_state === 'ics_sent')
    after.emailIds.push(...(await queueIcsEmail(c, requestId, 'CANCEL')));
  const moved = await c.query(
    `update request
        set status = 'needs_new_time', locked_slot_id = null, locked_starts_at = null, locked_ends_at = null,
            locked_where = null, awaiting_jon_since = case when $2 then null else $3::timestamptz end
      where id = $1 and status = 'locked'`,
    [requestId, offerId !== null, now],
  );
  if (moved.rowCount !== 1) throw new Error(`block_confirm: booking ${requestId} is no longer locked`);
  after.outboxIds.push(await enqueueCalendar(c, 'calendar_delete', requestId));
  after.emailIds.push(
    ...queuedId(
      await queueEmail(c, {
        template: 'E5b',
        to: r.contact_email,
        requestId,
        eventKey: offerId ?? auditId, // TSD: E5b = the offer id; with no offer, this move's audit row
        vars: {
          dish,
          openTimes: offerId
            ? E5B_PARTS.withTimes(starts.map((s) => timeLabel(s, r.guest_time_zone)).join('\n'))
            : E5B_PARTS.noTimes,
          takeLink: offerId ? takeLink(offerId) : '',
        },
      }),
    ),
  );
}

/**
 * pr59 H1: FOR UPDATE on every request row the confirm may touch (the chosen ones and the locked hosts in the
 * range, by id so two confirms can't deadlock), BEFORE the week locks (L3). A cancel or a lock holding one of
 * them makes us wait for its commit; lockedBookingsIn, a later statement, then sees what it wrote.
 */
async function lockCandidates(c: PoolClient, input: ConfirmBlockInput, now: Date): Promise<void> {
  await c.query(
    `select r.id from request r
      where r.id = any($1::uuid[])
         or (r.status = 'locked' and r.joined_to_request_id is null and r.locked_starts_at > $4
             and tstzrange(r.locked_starts_at, r.locked_ends_at)
                 && tstzrange($2::date::timestamp at time zone 'America/Vancouver',
                              ($3::date + 1)::timestamp at time zone 'America/Vancouver'))
      order by r.id
      for update`,
    [input.bookings.map((b) => b.requestId), input.block.startDate, input.block.endDate, now],
  );
}

/**
 * pr59 M1 + verify N1: an offered window touching a date the new block, or any block already there, covers. Every
 * date the window touches (datesTouched, as canLock checks it), so one running past midnight into a block counts.
 * A single-window block (T2.5.06) covers only its slot's times: an offered time overlapping them (canLock's rule).
 */
async function inABlock(
  c: PoolClient,
  block: ConfirmBlockInput['block'],
  options: SuggestOptions,
): Promise<boolean> {
  const windows =
    'ranges' in options
      ? options.ranges
      : (
          await c.query<{ startsAt: Date; endsAt: Date }>(
            `select starts_at as "startsAt", ends_at as "endsAt" from slot where id = any($1::uuid[])`,
            [options.slotIds],
          )
        ).rows;
  const dates = [...new Set(windows.flatMap((w) => datesTouched(w.startsAt, w.endsAt)))];
  if (block.window == null && dates.some((d) => d >= block.startDate && d <= block.endDate)) return true;
  const { rowCount } = await c.query(
    `select 1 from availability_block b, unnest($1::date[]) d
      where b.window_kind is null and d between b.start_date and b.end_date
     union all
     select 1 from slot s, unnest($2::timestamptz[], $3::timestamptz[]) w(starts_at, ends_at)
      where tstzrange(s.starts_at, s.ends_at) && tstzrange(w.starts_at, w.ends_at)
        and ((s.date = $4::date and s.window_kind = $5::slot_window)
             or exists (select 1 from availability_block b
                         where b.start_date = s.date and b.window_kind = s.window_kind))`,
    [
      dates,
      windows.map((w) => w.startsAt),
      windows.map((w) => w.endsAt),
      block.startDate,
      block.window ?? null,
    ],
  );
  return (rowCount ?? 0) > 0;
}

async function confirmTx(
  c: PoolClient,
  input: ConfirmBlockInput,
  now: Date,
): Promise<{ result: ConfirmBlockResult; after: AfterCommit }> {
  const none = noSideEffects();
  await lockCandidates(c, input, now);
  const refused = await lockBlockRange(c, input.block);
  if (refused) return { result: refused, after: none };
  const affected = await lockedBookingsIn(c, input.block, now);
  // T2.5.05: under way at `now` = left to finish (no move, no E5b), only reported back.
  const underWay = await underWayBookingsIn(c, input.block, now);
  const chosen = new Map(input.bookings.map((b) => [b.requestId, b]));
  if (affected.length !== chosen.size || affected.some((a) => !chosen.has(a.id))) {
    return { result: { ok: false, status: 409, reason: 'locked_bookings', affected, underWay }, after: none };
  }
  // Every choice is checked before anything is written: one bad time refuses the whole confirm.
  const plans: { id: string; options: SuggestOptions | null; starts: Date[] }[] = [];
  for (const a of affected) {
    const options = optionsOf(chosen.get(a.id)!);
    if (options === undefined) return { result: { ok: false, status: 400, reason: 'invalid' }, after: none };
    const starts = options ? await offeredStarts(c, options, now) : [];
    if (starts === 'slot_not_found')
      return { result: { ok: false, status: 404, reason: starts }, after: none };
    if (starts === 'in_the_past') return { result: { ok: false, status: 409, reason: starts }, after: none };
    if (options && (await inABlock(c, input.block, options)))
      return { result: { ok: false, status: 409, reason: 'in_block' }, after: none };
    plans.push({ id: a.id, options, starts });
  }
  const id = await insertBlock(c, input.block);
  const after = noSideEffects();
  for (const p of plans) await moveBooking(c, p.id, p.options, p.starts, now, after);
  return { result: { ok: true, id, moved: plans.map((p) => p.id), underWay }, after };
}

/** T2.5.02: add the block and move the bookings it covers (see the header). */
export async function confirmBlock(input: ConfirmBlockInput, now = new Date()): Promise<ConfirmBlockResult> {
  const { result, after } = await withTx((c) => confirmTx(c, input, now));
  await runAfterCommit(after, 'block_confirm');
  return result;
}
