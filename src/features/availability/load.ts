// src/lib/engine/load.ts — the thin database loader for C3 (T0.5). Server-only.
import 'server-only';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { pool } from '@/lib/db';
import { loadSettings, toEngineSettings } from '@/lib/settings';
import type {
  Block,
  Booking,
  BusyInterval,
  EngineInput,
  InviteKind,
  Offer,
  Slot,
  Week,
  WindowKind,
} from './types';

type Loaded = Omit<EngineInput, 'inviteKind' | 'dishWindows' | 'viewerRequestId' | 'busy'>;

/**
 * `db` = the lock transaction's client in T2.3 (read after the week row lock, so a lock sees every booking
 * committed before it); the pool elsewhere. Inside a transaction EVERY read, settings included, uses that client:
 * a second pool connection there can deadlock the pool under concurrent locks (review H1).
 */
export async function loadEngineData(now = new Date(), db: Pool | PoolClient = pool()): Promise<Loaded> {
  // pg forbids overlapping queries on one client, so a transaction's queries run one after another.
  const serial = 'release' in db;
  let last: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(read: () => Promise<T>): Promise<T> => {
    if (!serial) return read();
    const p = last.then(read);
    last = p.catch(() => undefined);
    return p;
  };
  const q = <T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> =>
    inTurn(() => db.query<T>(sql, params).then((r) => r.rows));
  const [settings, slots, weeks, bookings, blocks, offers] = await Promise.all([
    inTurn(() => loadSettings(db)),
    q<{ id: string; date: string; window_kind: WindowKind; starts_at: Date; ends_at: Date }>(
      `select id, date::text, window_kind, starts_at, ends_at from slot order by starts_at`,
    ),
    q<{ week_start: string; cap_override: number | null }>(`select week_start::text, cap_override from week`),
    q<{
      id: string;
      locked_starts_at: Date;
      locked_ends_at: Date;
      counts_toward: Booking['countsToward'];
      joined_to_request_id: string | null;
      dish: string;
    }>(
      `select id, locked_starts_at, locked_ends_at, counts_toward, joined_to_request_id, dish
         from request where status in ('locked','done') and locked_starts_at is not null`,
    ),
    // T2.5.06: a single-window block carries its slot's times (a range lock must not cover them).
    q<{
      start_date: string;
      end_date: string;
      kind: Block['kind'];
      confirm_by: string | null;
      window_kind: WindowKind | null;
      starts_at: Date | null;
      ends_at: Date | null;
    }>(
      `select b.start_date::text, b.end_date::text, b.kind, b.confirm_by::text, b.window_kind, s.starts_at, s.ends_at
         from availability_block b
         left join slot s on s.date = b.start_date and s.window_kind = b.window_kind`,
    ),
    q<{
      id: string;
      request_id: string;
      kind: Offer['kind'];
      slot_ids: string[];
      ranges: { starts_at: string; ends_at: string }[];
      expires_at: Date | null;
      taken_at: Date | null;
      released_at: Date | null;
    }>(
      `select id, request_id, kind, slot_ids, ranges, expires_at, taken_at, released_at
         from offer where kind = 'standby_open' and taken_at is null and released_at is null and (expires_at is null or expires_at > $1)`,
      [now],
    ),
  ]);
  return {
    now,
    settings: toEngineSettings(settings),
    slots: slots.map((s): Slot => ({
      id: s.id,
      date: s.date,
      windowKind: s.window_kind,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
    })),
    weeks: weeks.map((w): Week => ({ weekStart: w.week_start, capOverride: w.cap_override })),
    bookings: bookings.map((b): Booking => ({
      requestId: b.id,
      startsAt: b.locked_starts_at,
      endsAt: b.locked_ends_at,
      countsToward: b.counts_toward,
      joinedToRequestId: b.joined_to_request_id,
      dish: b.dish,
    })),
    blocks: blocks.map((b): Block => ({
      startDate: b.start_date,
      endDate: b.end_date,
      kind: b.kind,
      confirmBy: b.confirm_by,
      window: b.window_kind,
      windowRange: b.starts_at && b.ends_at ? { startsAt: b.starts_at, endsAt: b.ends_at } : null,
    })),
    offers: offers.map((o): Offer => ({
      id: o.id,
      requestId: o.request_id,
      kind: o.kind,
      slotIds: o.slot_ids,
      ranges: o.ranges.map((r) => ({ startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at) })),
      expiresAt: o.expires_at,
      takenAt: o.taken_at,
      releasedAt: o.released_at,
    })),
  };
}

export function engineInput(
  loaded: Loaded,
  busy: BusyInterval[] | null,
  inviteKind: InviteKind,
  dishWindows: WindowKind[],
  viewerRequestId?: string,
): EngineInput {
  return { ...loaded, busy, inviteKind, dishWindows, viewerRequestId };
}

/** Ask for another time (T2.7): the guest's own current booking must not hide or cap their own new pick. */
export function withoutOwnBooking(loaded: Loaded, requestId: string | null): Loaded {
  if (!requestId) return loaded;
  return { ...loaded, bookings: loaded.bookings.filter((b) => b.requestId !== requestId) };
}

/** QA4 L2: the slot a request is booked on now (a joined guest's: its host's), or null. */
export async function bookedSlotOf(requestId: string): Promise<string | null> {
  const { rows } = await pool().query<{ slot: string | null }>(
    `select coalesce(r.locked_slot_id, h.locked_slot_id) as slot
       from request r left join request h on h.id = r.joined_to_request_id
      where r.id = $1 and r.status = 'locked'`,
    [requestId],
  );
  return rows[0]?.slot ?? null;
}
