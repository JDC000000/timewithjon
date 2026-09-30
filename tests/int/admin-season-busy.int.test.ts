// T3.5.02 (TSD T3.5, A4): the season view's "Busy on main calendar" markers, from the prototype free/busy fixture
// (Thu Apr 15 12:30-13:30, Fri May 21 18:00-23:00 Vancouver) through the shared 10-minute cache, minus the app's own
// bookings (J2), failing open (C3 rule 7). Each test starts with no cache and no cooldown.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { seasonView } from '@/features/admin/season-view';
import { FREEBUSY_FAILED_KEY } from '@/features/availability/busy';
import { mockFreeBusy } from '@/lib/adapters/mock/freebusy';
import { vancouverInstant } from '@/lib/time';
import { GET as seasonRoute } from '@/app/api/admin/season/route';
import { cancelMade, lockDirect, newRequest } from '../fixtures/requests-db';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const NOW = new Date('2027-03-01T18:00:00Z');
const at = (d: string, t: string) => vancouverInstant(d, t).toISOString();
const marker = (d: string, a: string, b: string) => ({ startsAt: at(d, a), endsAt: at(d, b) });
const byWeek = (v: Awaited<ReturnType<typeof seasonView>>) =>
  Object.fromEntries(v.weeks.filter((w) => w.busy.length).map((w) => [w.weekStart, w.busy]));

const reset = async () => {
  await q(`delete from freebusy_cache`);
  await q(`delete from system_status where key = $1`, [FREEBUSY_FAILED_KEY]);
};
beforeEach(reset);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await reset();
  await cancelMade();
});

describe('seasonView busy markers (T3.5.02)', () => {
  it("each fixture block lands in its own week; the rest have none; the view is 'ok'", async () => {
    const v = await seasonView(NOW);
    expect(v.mainCalendar).toBe('ok');
    expect(byWeek(v)).toEqual({
      '2027-04-12': [marker('2027-04-15', '12:30', '13:30')],
      '2027-05-17': [marker('2027-05-21', '18:00', '23:00')],
    });
  });

  it("the app's own locked booking is taken out (J2), leaving only the rest of the busy block", async () => {
    const id = await newRequest({ name: 'Busy Overlap' });
    await lockDirect(id, {
      startsAt: vancouverInstant('2027-05-21', '18:00'),
      endsAt: vancouverInstant('2027-05-21', '20:00'),
    });
    expect(byWeek(await seasonView(NOW))['2027-05-17']).toEqual([marker('2027-05-21', '20:00', '23:00')]);
    await q(`update request set status = 'cancelled', cancelled_at = now() where id = $1`, [id]);
  });

  it('shares the one free/busy cache: no second call within 10 minutes, a refetch after', async () => {
    const spy = vi.spyOn(mockFreeBusy, 'busy');
    await seasonView(NOW);
    await seasonView(new Date(NOW.getTime() + 9 * 60_000));
    expect(spy).toHaveBeenCalledTimes(1);
    await seasonView(new Date(NOW.getTime() + 11 * 60_000)); // the view's clock drives the TTL
    expect(spy).toHaveBeenCalledTimes(2);
    // The same season range as the guest picker (busy.ts), so both read the same row.
    const [s] = await q<{ season_start: string; season_end: string }>(
      `select season_start::text, season_end::text from settings`,
    );
    expect(spy).toHaveBeenCalledWith(
      vancouverInstant(s!.season_start, '00:00'),
      vancouverInstant(
        new Date(Date.parse(`${s!.season_end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
        '00:00',
      ),
    );
  });

  it("Google down with no cache: the view still loads, no markers, mainCalendar 'unavailable' (fails open)", async () => {
    vi.spyOn(mockFreeBusy, 'busy').mockRejectedValue(new Error('down'));
    const v = await seasonView(NOW);
    expect(v.mainCalendar).toBe('unavailable');
    expect(v.weeks).toHaveLength(14);
    expect(v.weeks.every((w) => w.busy.length === 0)).toBe(true);
  });

  it('pr62 M1: a Sunday-night block splits at Vancouver Monday 00:00; a moved-off or cancelled booking is not subtracted', async () => {
    vi.spyOn(mockFreeBusy, 'busy').mockResolvedValue([
      { start: vancouverInstant('2027-05-23', '20:00'), end: vancouverInstant('2027-05-24', '02:00') },
    ]);
    const moved = await newRequest({ name: 'Busy Moved' });
    const gone = await newRequest({ name: 'Busy Gone' });
    // One at a time (request_no_overlap): each is locked on the block, then leaves 'locked'.
    for (const [id, leave] of [
      [moved, `status = 'needs_new_time'`],
      [gone, `status = 'cancelled', cancelled_at = now()`],
    ] as const) {
      await lockDirect(id, {
        startsAt: vancouverInstant('2027-05-23', '20:00'),
        endsAt: vancouverInstant('2027-05-23', '22:00'),
      });
      await q(`update request set ${leave} where id = $1`, [id]);
    }
    const weeks = byWeek(await seasonView(NOW));
    expect(weeks['2027-05-17']).toEqual([
      { startsAt: at('2027-05-23', '20:00'), endsAt: at('2027-05-24', '00:00') },
    ]);
    expect(weeks['2027-05-24']).toEqual([marker('2027-05-24', '00:00', '02:00')]);
  });

  it('pr62 L1: mainCalendarAsOf is the fetch time: fresh, then cached; the stale cache during an outage keeps its old time', async () => {
    const v = await seasonView(NOW);
    expect(v.mainCalendarAsOf).toBe(NOW.toISOString());
    expect((await seasonView(new Date(NOW.getTime() + 9 * 60_000))).mainCalendarAsOf).toBe(NOW.toISOString());
    vi.spyOn(mockFreeBusy, 'busy').mockRejectedValue(new Error('down'));
    const outage = await seasonView(new Date(NOW.getTime() + 3 * 3_600_000)); // cache 3 h old, served
    expect(outage).toMatchObject({ mainCalendar: 'ok', mainCalendarAsOf: NOW.toISOString() });
    expect(byWeek(outage)['2027-04-12']).toEqual([marker('2027-04-15', '12:30', '13:30')]);
    // Over 24 h: the old cache is no longer served, so no markers and no time.
    const tooOld = await seasonView(new Date(NOW.getTime() + 25 * 3_600_000));
    expect(tooOld).toMatchObject({ mainCalendar: 'unavailable', mainCalendarAsOf: null });
    await reset();
    const none = await seasonView(NOW);
    expect(none).toMatchObject({ mainCalendar: 'unavailable', mainCalendarAsOf: null });
  });

  it('the admin route carries the markers', async () => {
    const res = await seasonRoute(
      new NextRequest('http://localhost:3000/api/admin/season', {
        headers: { origin: 'http://localhost:3000' },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mainCalendar: string;
      weeks: { weekStart: string; busy: unknown[] }[];
    };
    expect(body.mainCalendar).toBe('ok');
    expect(body.weeks.find((w) => w.weekStart === '2027-04-12')!.busy).toEqual([
      marker('2027-04-15', '12:30', '13:30'),
    ]);
  });
});
