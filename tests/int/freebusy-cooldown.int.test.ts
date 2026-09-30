// tests/int/freebusy-cooldown.int.test.ts — pr41 F3: after a failed free/busy fetch (Google down, dead grant),
// getBusy stops calling Google for FREEBUSY_COOLDOWN_MS, keeps failing open, and warns once per cooldown.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { q } from '@/lib/db';

const h = vi.hoisted(() => ({
  busy: vi.fn<(from: Date, to: Date) => Promise<{ start: Date; end: Date }[]>>(),
  warn: vi.fn<(message: string, tags: Record<string, string>) => void>(),
}));
vi.mock('@/lib/adapters', () => ({ adapters: () => ({ freeBusy: { busy: h.busy } }) }));
vi.mock('@/lib/report', async (orig) => ({
  ...(await orig<typeof import('@/lib/report')>()),
  reportMessage: h.warn,
}));

const { getBusy, FREEBUSY_COOLDOWN_MS, FREEBUSY_FAILED_KEY } = await import('@/features/availability/busy');

const SEASON = { start: '2031-05-01', end: '2031-09-30' };
const T0 = new Date('2031-05-01T17:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const BLOCK = { start: new Date('2031-06-01T18:00:00Z'), end: new Date('2031-06-01T19:00:00Z') };
const mark = async () =>
  (
    await q<{ updated_at: Date }>(`select updated_at from system_status where key = $1`, [
      FREEBUSY_FAILED_KEY,
    ])
  )[0]?.updated_at ?? null;

beforeEach(async () => {
  h.busy.mockReset();
  h.warn.mockReset();
  await q('delete from freebusy_cache');
  await q(`delete from system_status where key = $1`, [FREEBUSY_FAILED_KEY]);
});
afterEach(async () => {
  await q('delete from freebusy_cache');
  await q(`delete from system_status where key = $1`, [FREEBUSY_FAILED_KEY]);
});

describe('free/busy failure cooldown (pr41 F3)', () => {
  it('no cache: one Google call and one warning per cooldown; every render fails open (no filter)', async () => {
    h.busy.mockRejectedValue(new Error('down'));
    expect(await getBusy(SEASON, T0)).toBeNull();
    expect(await mark()).toEqual(T0);
    expect(await getBusy(SEASON, at(60_000))).toBeNull();
    expect(await getBusy(SEASON, at(FREEBUSY_COOLDOWN_MS - 1))).toBeNull();
    expect(h.busy).toHaveBeenCalledTimes(1);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0]![0]).toBe('freebusy_failed_no_filter: Error');
    expect(await mark()).toEqual(T0); // stored once, not per render
    expect(await getBusy(SEASON, at(FREEBUSY_COOLDOWN_MS))).toBeNull(); // the cooldown is over: try again
    expect(h.busy).toHaveBeenCalledTimes(2);
    expect(h.warn).toHaveBeenCalledTimes(2);
    expect(await mark()).toEqual(at(FREEBUSY_COOLDOWN_MS));
  });

  it('a stale cache (under 24 h) is served during the cooldown; a success clears the mark', async () => {
    await q(`insert into freebusy_cache (id, fetched_at, busy) values (true, $1, $2)`, [
      at(-3_600_000),
      JSON.stringify([BLOCK]),
    ]);
    h.busy.mockRejectedValueOnce(new Error('down'));
    expect(await getBusy(SEASON, T0)).toEqual([BLOCK]);
    expect(await getBusy(SEASON, at(120_000))).toEqual([BLOCK]);
    expect(h.busy).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls.map((c) => c[0])).toEqual(['freebusy_failed_using_cache: Error']);
    h.busy.mockResolvedValueOnce([]);
    expect(await getBusy(SEASON, at(FREEBUSY_COOLDOWN_MS + 1))).toEqual([]);
    expect(await mark()).toBeNull();
    // The fresh cache now answers; a later failure starts a new cooldown from scratch.
    expect(await getBusy(SEASON, at(FREEBUSY_COOLDOWN_MS + 2))).toEqual([]);
    expect(h.busy).toHaveBeenCalledTimes(2);
  });

  it("a mark from another instance's clock ahead of ours does not stop the fetch", async () => {
    await q(`insert into system_status (key, value, updated_at) values ($1, null, $2)`, [
      FREEBUSY_FAILED_KEY,
      at(60_000),
    ]);
    h.busy.mockResolvedValueOnce([]);
    expect(await getBusy(SEASON, T0)).toEqual([]);
    expect(h.busy).toHaveBeenCalledTimes(1);
  });

  it('a success with no failure behind it writes no mark', async () => {
    h.busy.mockResolvedValueOnce([BLOCK]);
    expect(await getBusy(SEASON, T0)).toEqual([BLOCK]);
    expect(await mark()).toBeNull();
    expect(h.warn).not.toHaveBeenCalled();
  });
});
