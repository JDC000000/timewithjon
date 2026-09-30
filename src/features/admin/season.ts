// src/features/admin/season.ts — T2.5.01: Jon's season controls (TSD T2.5, A4): blocks and away mode, the weekly
// cap override, releasing the household hold. Server-only; every caller has passed requireAdmin().
//
// A block or away range over a LOCKED booking is refused here with the affected bookings (the pre-check).
// Moving those bookings to needs_new_time with E5b is T2.5.02 (preview → confirm, block-confirm.ts).
import 'server-only';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool, withTx } from '@/lib/db';
import { isThuFri } from '@/features/availability/rules';
import type { WindowKind } from '@/features/availability/types';
import { MAX_LENGTH_MINUTES } from '@/features/requests/lock-api';
import { addDays, weekStartOf } from '@/lib/time';

/** How many days back a booking can start and still reach into a block: the lock path's longest booking. */
const LOOKBACK_DAYS = Math.ceil(MAX_LENGTH_MINUTES / (24 * 60));
const NOTE_MAX = 200;

export const BlockBody = z
  .strictObject({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    kind: z.enum(['blocked', 'away']),
    confirmBy: z.iso.date().nullable().default(null), // away mode only, and required there: "I'll confirm by …"
    note: z.string().trim().max(NOTE_MAX).nullable().default(null),
    // T2.5.06: one window of one Thu/Fri; null (or left out, as A4's per-date editor does) = the whole day(s).
    window: z.enum(['lunch', 'evening']).nullable().default(null),
  })
  .refine((b) => b.endDate >= b.startDate, { message: 'end_before_start' })
  .refine((b) => b.window === null || (b.kind === 'blocked' && b.startDate === b.endDate), {
    message: 'window_is_one_blocked_day',
  })
  .refine((b) => b.window === null || isThuFri(b.startDate), { message: 'window_needs_thu_fri' })
  .refine((b) => b.kind === 'away' || b.confirmBy === null, { message: 'confirm_by_is_away_only' })
  .refine((b) => b.kind !== 'away' || b.confirmBy !== null, { message: 'confirm_by_required' }); // TSD T2.5
/** The parsed body; `window` may be left out by server callers too (= null, the whole day(s)). */
export type BlockInput = Omit<z.infer<typeof BlockBody>, 'window'> & { window?: WindowKind | null };

export const CapBody = z.strictObject({ capOverride: z.number().int().min(0).max(10).nullable() });

export interface AffectedBooking {
  id: string;
  contactName: string;
  dish: string;
  startsAt: string;
  endsAt: string;
  joinedGuests: number; // rule 3: joined guests follow their host
}

export type SeasonResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; status: 400 | 404; reason: string }
  | {
      ok: false;
      status: 409;
      reason: 'locked_bookings';
      affected: AffectedBooking[];
      underWay: AffectedBooking[];
    };

export type SeasonRefusal = Exclude<SeasonResult, { ok: true }>;

type Db = Pick<PoolClient, 'query'>;

type Phase = 'ahead' | 'under_way';

/** What a block covers: whole Vancouver local dates, or (T2.5.06) one window of startDate (= endDate). */
export interface BlockSpan {
  startDate: string;
  endDate: string;
  window?: WindowKind | null;
}

/**
 * The locked bookings (hosts only; joined guests are counted on their host) whose range touches any Vancouver
 * local date in [startDate, endDate], or for a window block (T2.5.06) overlaps that window's slot times: 'ahead' = not started yet (a block moves them: E5b), 'under_way' = started
 * and not ended at `now` (T2.5.05, decision 30 #21 (b): left to finish, no E5b, no "Something came up"
 * mid-meeting, only named in the preview). Ended bookings are Done (lazy done) and in neither list.
 */
async function bookingsIn(db: Db, phase: Phase, span: BlockSpan, now: Date): Promise<AffectedBooking[]> {
  const when =
    phase === 'ahead' ? 'r.locked_starts_at > $3' : 'r.locked_starts_at <= $3 and r.locked_ends_at > $3';
  const { rows } = await db.query<{
    id: string;
    contact_name: string;
    dish: string;
    locked_starts_at: Date;
    locked_ends_at: Date;
    joined: number;
  }>(
    `select r.id, r.contact_name, r.dish, r.locked_starts_at, r.locked_ends_at,
            (select count(*)::int from request j
              where j.joined_to_request_id = r.id and j.status = 'locked') as joined
       from request r
      where r.status = 'locked' and r.joined_to_request_id is null
        and ${when}
        and tstzrange(r.locked_starts_at, r.locked_ends_at)
            && case when $4::slot_window is null
                 then tstzrange($1::date::timestamp at time zone 'America/Vancouver',
                                ($2::date + 1)::timestamp at time zone 'America/Vancouver')
                 else (select tstzrange(s.starts_at, s.ends_at) from slot s
                        where s.date = $1::date and s.window_kind = $4::slot_window)
               end
      order by r.locked_starts_at, r.id`,
    [span.startDate, span.endDate, now, span.window ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    contactName: r.contact_name,
    dish: r.dish,
    startsAt: r.locked_starts_at.toISOString(),
    endsAt: r.locked_ends_at.toISOString(),
    joinedGuests: r.joined,
  }));
}

/** The bookings a block over this span moves to needs_new_time (not started yet at `now`). */
export function lockedBookingsIn(db: Db, span: BlockSpan, now: Date) {
  return bookingsIn(db, 'ahead', span, now);
}

/** T2.5.05: the bookings under way at `now` in this span; a block leaves them to finish (listed only). */
export function underWayBookingsIn(db: Db, span: BlockSpan, now: Date) {
  return bookingsIn(db, 'under_way', span, now);
}

export interface BlockPreview {
  affected: AffectedBooking[];
  underWay: AffectedBooking[];
}

/**
 * Read-only preview for A4: what a block over these dates (or one window of the date, T2.5.06) would move, and
 * what it leaves to finish (T2.5.05).
 */
export async function previewBlock(
  startDate: string,
  endDate: string,
  now = new Date(),
  window: WindowKind | null = null,
): Promise<BlockPreview> {
  const db = pool();
  const span = { startDate, endDate, window };
  const [affected, underWay] = await Promise.all([
    lockedBookingsIn(db, span, now),
    underWayBookingsIn(db, span, now),
  ]);
  return { affected, underWay };
}

export async function audit(db: Db, action: string): Promise<void> {
  await db.query(`insert into audit_log (actor, action) values ('jon', $1)`, [action]);
}

/**
 * The season check, then the week rows a block over these dates can touch, FOR UPDATE (the same row lock the lock
 * path takes, lock.ts), so a booking can't be locked into the range between the pre-check and the insert. Inside
 * the caller's transaction; null when the range may go ahead.
 */
export async function lockBlockRange(c: PoolClient, input: BlockInput): Promise<SeasonRefusal | null> {
  const season = (
    await c.query<{ season_start: string; season_end: string }>(
      `select season_start::text, season_end::text from settings where id`,
    )
  ).rows[0];
  if (!season) throw new Error('settings row missing: run the seed');
  if (input.endDate < season.season_start || input.startDate > season.season_end) {
    return { ok: false, status: 400, reason: 'out_of_season' };
  }
  if (input.window != null) {
    // T2.5.06: a window block needs that window's slot (its times); a seeded season has one per Thu/Fri window.
    const { rowCount } = await c.query(`select 1 from slot where date = $1 and window_kind = $2`, [
      input.startDate,
      input.window,
    ]);
    if (!rowCount) return { ok: false, status: 400, reason: 'no_such_window' };
  }
  const from = weekStartOf(addDays(input.startDate, -LOOKBACK_DAYS));
  const { rows: held } = await c.query<{ week_start: string }>(
    `select week_start::text from week where week_start between $1 and $2 order by week_start for update`,
    [from, input.endDate],
  );
  // A week with no row: take the advisory lock lock.ts takes in its place (same key), in ascending order.
  const rowWeeks = new Set(held.map((w) => w.week_start));
  for (let week = from; week <= input.endDate; week = addDays(week, 7)) {
    if (!rowWeeks.has(week)) {
      await c.query(`select pg_advisory_xact_lock(hashtext('twj_week:' || $1))`, [week]);
    }
  }
  return null;
}

/**
 * The availability_block row and its audit, inside the caller's transaction (after lockBlockRange). An identical
 * block (same dates, kind and window) already there is returned instead (pr59 L2: a double tap adds one); the week locks
 * serialise two taps, so the second sees the first's row.
 */
export async function insertBlock(c: PoolClient, input: BlockInput): Promise<string> {
  const same = await c.query<{ id: string }>(
    `select id from availability_block
      where start_date = $1 and end_date = $2 and kind = $3 and window_kind is not distinct from $4::slot_window
      order by id limit 1`,
    [input.startDate, input.endDate, input.kind, input.window ?? null],
  );
  if (same.rows[0]) return same.rows[0].id;
  const { rows } = await c.query<{ id: string }>(
    `insert into availability_block (start_date, end_date, kind, confirm_by, note, window_kind)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [input.startDate, input.endDate, input.kind, input.confirmBy, input.note || null, input.window ?? null],
  );
  await audit(c, input.kind === 'away' ? 'away_added' : 'block_added');
  return rows[0]!.id;
}

/**
 * Adds a block or an away range; over a locked booking it's refused with the affected list (confirm: T2.5.02).
 * Either way the bookings under way in the range come back as `underWay` (T2.5.05): untouched, left to finish.
 */
export async function block(
  input: BlockInput,
  now = new Date(),
): Promise<SeasonResult<{ id: string; underWay: AffectedBooking[] }>> {
  return withTx(async (c) => {
    const refused = await lockBlockRange(c, input);
    if (refused) return refused;
    const affected = await lockedBookingsIn(c, input, now);
    const underWay = await underWayBookingsIn(c, input, now);
    if (affected.length > 0) return { ok: false, status: 409, reason: 'locked_bookings', affected, underWay };
    return { ok: true, id: await insertBlock(c, input), underWay };
  });
}

export async function unblock(id: string): Promise<SeasonResult> {
  return withTx(async (c) => {
    const { rows } = await c.query<{ kind: string }>(
      `delete from availability_block where id = $1 returning kind`,
      [id],
    );
    if (!rows[0]) return { ok: false, status: 404, reason: 'not_found' };
    await audit(c, rows[0].kind === 'away' ? 'away_removed' : 'block_removed');
    return { ok: true };
  });
}

/** null clears the override (the week falls back to settings.default_weekly_cap). */
export async function setCapOverride(weekStart: string, capOverride: number | null): Promise<SeasonResult> {
  return withTx(async (c) => {
    const { rowCount } = await c.query(`update week set cap_override = $2 where week_start = $1::date`, [
      weekStart,
      capOverride,
    ]);
    if (!rowCount) return { ok: false, status: 404, reason: 'not_found' };
    await audit(c, capOverride === null ? 'cap_override_cleared' : 'cap_override_set');
    return { ok: true };
  });
}

/** Rule 2(c): opens Thu Apr 1 lunch. One-way and idempotent; `changed` is false on a repeat. */
export async function releaseHousehold(): Promise<SeasonResult<{ changed: boolean }>> {
  return withTx(async (c) => {
    const { rowCount } = await c.query(
      `update settings set household_hold_released = true, updated_at = now()
        where id and not household_hold_released`,
    );
    if (rowCount) await audit(c, 'household_hold_released');
    return { ok: true, changed: Boolean(rowCount) };
  });
}
