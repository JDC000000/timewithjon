// src/lib/engine/busy.ts — C3 rule 7 wiring: 10-minute cache in freebusy_cache, fail open. A failed fetch starts
// a 5-minute cooldown (pr41 F3) so a Google outage or a dead grant isn't retried on every guest page render.
import 'server-only';
import { errorName, report, reportMessage } from '@/lib/report';
import { addDays, vancouverInstant } from '@/lib/time';
import { adapters } from '@/lib/adapters';
import { q } from '@/lib/db';
import { resolveBusy } from './freebusy';
import type { BusyInterval } from './types';

/** pr41 F3: after a failed fetch, Google isn't called again for this long (every render fails open meanwhile). */
export const FREEBUSY_COOLDOWN_MS = 5 * 60 * 1000;
export const FREEBUSY_FAILED_KEY = 'freebusy_failed_at';

/** Busy time (null = unknown: no filtering) and when it was read from Google (null with it). */
export interface BusyRead {
  busy: BusyInterval[] | null;
  /** pr62 L1: the fetch the answer comes from: `now` for a fresh fetch, the cache's fetched_at otherwise. */
  fetchedAt: Date | null;
}

export async function getBusy(
  season: { start: string; end: string },
  now = new Date(),
): Promise<BusyInterval[] | null> {
  return (await readBusy(season, now)).busy;
}

/** getBusy plus the age of its answer, for the admin view (A4 "as of", pr62 L1). */
export async function readBusy(season: { start: string; end: string }, now = new Date()): Promise<BusyRead> {
  // One read for the cache and the cooldown mark (system_status, written once per failure, not per render).
  const [row] = await q<{
    fetched_at: Date | null;
    busy: { start: string; end: string }[] | null;
    failed_at: Date | null;
  }>(
    `select c.fetched_at, c.busy, s.updated_at as failed_at
       from (select 1) one
       left join freebusy_cache c on c.id
       left join system_status s on s.key = $1`,
    [FREEBUSY_FAILED_KEY],
  );
  const cache =
    row?.fetched_at && row.busy
      ? {
          fetchedAt: row.fetched_at,
          busy: row.busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
        }
      : null;
  const fromCache = (busy: BusyInterval[] | null): BusyRead => ({
    busy,
    fetchedAt: busy ? (cache?.fetchedAt ?? null) : null,
  });
  const first = resolveBusy({ now, cache });
  if (!first.refetch) return fromCache(first.busy);
  const failedAt = row?.failed_at?.getTime();
  if (
    failedAt !== undefined &&
    now.getTime() - failedAt < FREEBUSY_COOLDOWN_MS &&
    now.getTime() >= failedAt
  ) {
    // Cooling down: the same fail-open answer as a failed fetch, with no Google call and no second warning.
    return fromCache(resolveBusy({ now, cache, fetchResult: { ok: false, error: 'cooldown' } }).busy);
  }
  let fetchResult: { ok: true; busy: BusyInterval[] } | { ok: false; error: string };
  try {
    fetchResult = {
      ok: true,
      busy: await adapters().freeBusy.busy(
        vancouverInstant(season.start, '00:00'),
        vancouverInstant(addDays(season.end, 1), '00:00'),
      ),
    };
  } catch (e) {
    fetchResult = { ok: false, error: errorName(e) }; // class name only: messages can carry PII
  }
  if (fetchResult.ok) {
    // A failed cache write must not throw away a good fetch (review T4.2.00 L6).
    await q(
      `insert into freebusy_cache (id, fetched_at, busy) values (true, $1, $2)
             on conflict (id) do update set fetched_at = excluded.fetched_at, busy = excluded.busy`,
      [now, JSON.stringify(fetchResult.busy)],
    ).catch((e: unknown) => report(e, { area: 'freebusy_cache' }));
    if (failedAt !== undefined) {
      await q(`delete from system_status where key = $1`, [FREEBUSY_FAILED_KEY]).catch((e: unknown) =>
        report(e, { area: 'freebusy_cache' }),
      );
    }
  } else {
    await q(
      `insert into system_status (key, value, updated_at) values ($1, null, $2)
         on conflict (key) do update set updated_at = excluded.updated_at`,
      [FREEBUSY_FAILED_KEY, now],
    ).catch((e: unknown) => report(e, { area: 'freebusy_cache' }));
  }
  const r = resolveBusy({ now, cache, fetchResult });
  if (r.warning) reportMessage(r.warning, { area: 'freebusy' }); // one per cooldown
  return fetchResult.ok ? { busy: r.busy, fetchedAt: now } : fromCache(r.busy);
}
