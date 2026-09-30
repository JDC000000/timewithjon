// T2.5.06: a block on ONE window of a Thu/Fri, against the test DB. The migration over existing (date-only) rows,
// the admin API's validation and auth, the picker and the lock path honouring it, the preview/confirm per window,
// and the A4 week's per-window state (GET /api/admin/season/weeks/[weekStart]).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { pool, q, withTx } from '@/lib/db';
import { openWindows } from '@/features/availability';
import { engineInput, loadEngineData } from '@/features/availability/load';
import { currentAuthEmail } from '@/features/admin/supabase';
import { seasonView } from '@/features/admin/season-view';
import { lockRequest } from '@/features/requests/lock';
import { POST as blocksRoute } from '@/app/api/admin/season/blocks/route';
import { POST as confirmRoute } from '@/app/api/admin/season/blocks/confirm/route';
import { GET as previewRoute } from '@/app/api/admin/season/blocks/preview/route';
import { DELETE as blockRoute } from '@/app/api/admin/season/blocks/[id]/route';
import { GET as weekRoute } from '@/app/api/admin/season/weeks/[weekStart]/route';
import { cancelMade, lockDirect, newRequest, slotId } from '../fixtures/requests-db';

vi.mock('@/lib/report', () => ({ report: vi.fn(), reportMessage: vi.fn() }));
vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
const BEFORE_SEASON = new Date('2027-03-10T18:00:00Z'); // after both release times, before the season
const WEEK = '2027-04-19';
const THU = '2027-04-22';
const FRI = '2027-04-23';
const MIGRATION = path.resolve(
  __dirname,
  '../../supabase/migrations/20261102000730_availability_block_window.sql',
);

const clearBlocks = () =>
  q(`delete from availability_block where start_date between $1 and '2027-04-25'`, [WEEK]);
beforeAll(clearBlocks);
afterAll(async () => {
  await clearBlocks();
  await q(`update offer set released_at = now() where released_at is null and taken_at is null
             and request_id in (select id from request where contact_name like 'Window %')`);
  await cancelMade();
  await pool().end();
});

const req = (method: string, url: string, body?: unknown, origin = SITE) =>
  new NextRequest(`${SITE}${url}`, {
    method,
    headers: { origin, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = <T>(p: T) => ({ params: Promise.resolve(p) });
const addBlock = (b: Record<string, unknown>, origin = SITE) =>
  blocksRoute(req('POST', '/api/admin/season/blocks', b, origin));
const removeBlock = (id: string) =>
  blockRoute(req('DELETE', `/api/admin/season/blocks/${id}`), params({ id }));
const preview = (qs: Record<string, string>) =>
  previewRoute(req('GET', `/api/admin/season/blocks/preview?${new URLSearchParams(qs)}`));
const weekWindows = async (weekStart = WEEK) => {
  const res = await weekRoute(req('GET', `/api/admin/season/weeks/${weekStart}`), params({ weekStart }));
  return {
    status: res.status,
    body: (await res.json()) as {
      windows?: {
        date: string;
        window: string;
        state: string;
        block: { id: string; scope: string } | null;
      }[];
    },
  };
};
const stateOf = async () =>
  Object.fromEntries(
    (await weekWindows()).body.windows!.map((w) => [
      `${w.date} ${w.window}`,
      [w.state, w.block?.scope ?? null],
    ]),
  );
const idOf = async (res: Response) => ((await res.json()) as { id: string }).id;
const pickerOpen = async () =>
  openWindows(engineInput(await loadEngineData(BEFORE_SEASON), [], 'general', ['lunch', 'evening']))
    .weeks.find((w) => w.weekStart === WEEK)!
    .windows.map((w) => `${w.date} ${w.window}`);
const one = (date: string, window: string | null, kind = 'blocked') => ({
  startDate: date,
  endDate: date,
  kind,
  window,
});

describe('T2.5.06 migration 20261102000730 over existing rows', () => {
  it('adds a null window to every date-only row, untouched; re-runnable; the checks hold', async () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const rolledBack = new Error('rollback');
    await withTx(async (c) => {
      // The table as it was before the migration, with date-only rows in it.
      await c.query(`alter table availability_block drop column window_kind`);
      await c.query(
        `insert into availability_block (start_date, end_date, kind, confirm_by, note) values
           ('2027-04-22', '2027-04-22', 'blocked', null, 'day'),
           ('2027-04-19', '2027-04-25', 'away', '2027-04-27', 'week')`,
      );
      const cols = `id, start_date::text, end_date::text, kind, confirm_by::text, note, created_at`;
      const before = (await c.query(`select ${cols} from availability_block order by id`)).rows;
      await c.query(sql);
      await c.query(sql); // additive and re-runnable
      const after = await c.query(`select ${cols}, window_kind from availability_block order by id`);
      expect(after.rows).toEqual(before.map((r) => ({ ...r, window_kind: null })));

      const refused = async (values: string) => {
        await c.query('savepoint s');
        const err = await c
          .query(
            `insert into availability_block (start_date, end_date, kind, confirm_by, window_kind) values ${values}`,
          )
          .then(
            () => null,
            (e: { code?: string }) => e.code,
          );
        await c.query('rollback to savepoint s');
        return err;
      };
      expect(await refused(`('2027-04-22', '2027-04-22', 'blocked', null, 'lunch')`)).toBeNull();
      expect(await refused(`('2027-04-22', '2027-04-22', 'blocked', null, 'brunch')`)).toBe('22P02');
      expect(await refused(`('2027-04-22', '2027-04-22', 'away', '2027-04-24', 'lunch')`)).toBe('23514');
      expect(await refused(`('2027-04-22', '2027-04-23', 'blocked', null, 'lunch')`)).toBe('23514');
      expect(await refused(`('2027-04-24', '2027-04-24', 'blocked', null, 'lunch')`)).toBe('23514');
      expect(
        await refused(
          `('2027-04-22', '2027-04-22', 'blocked', null, 'lunch'), ('2027-04-22', '2027-04-22', 'blocked', null, 'lunch')`,
        ),
      ).toBe('23505');
      // Date-only rows keep their old freedom (overlaps, repeats), and a window may sit inside a whole day.
      expect(
        await refused(
          `('2027-04-22', '2027-04-22', 'blocked', null, null), ('2027-04-22', '2027-04-22', 'blocked', null, 'evening')`,
        ),
      ).toBeNull();
      throw rolledBack;
    }).catch((e: unknown) => {
      if (e !== rolledBack) throw e;
    });
    const col = await q(
      `select 1 from information_schema.columns where table_name = 'availability_block' and column_name = 'window_kind'`,
    );
    expect(col).toHaveLength(1);
  });
});

describe('T2.5.06 admin API: POST /blocks with a window', () => {
  it('refuses a bad window, an away window, a multi-day window, a non-Thu/Fri window, out of season (400)', async () => {
    for (const bad of [
      one(THU, 'brunch'),
      one(THU, 'lunch', 'away'),
      { ...one(THU, 'lunch'), endDate: FRI },
      one('2027-04-24', 'evening'),
    ]) {
      const res = await addBlock(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, code: 'invalid' });
    }
    const late = await addBlock(one('2027-07-01', 'lunch'));
    expect(late.status).toBe(400);
    expect(await late.json()).toMatchObject({ code: 'out_of_season' });
    expect(await q(`select 1 from availability_block where window_kind is not null`)).toEqual([]);
  });

  it('401 with no session, 403 from a foreign Origin, nothing written', async () => {
    vi.mocked(currentAuthEmail).mockResolvedValueOnce(null);
    expect((await addBlock(one(THU, 'lunch'))).status).toBe(401);
    vi.mocked(currentAuthEmail).mockResolvedValueOnce(null);
    expect((await weekWindows()).status).toBe(401);
    vi.mocked(currentAuthEmail).mockResolvedValueOnce(null);
    expect((await preview({ startDate: THU, endDate: THU, window: 'lunch' })).status).toBe(401);
    expect((await addBlock(one(THU, 'lunch'), 'https://evil.example')).status).toBe(403);
    expect(await q(`select 1 from availability_block where window_kind is not null`)).toEqual([]);
  });

  it('a window block closes only that window (picker + week state); the whole day wins; a double tap adds one', async () => {
    expect(await pickerOpen()).toEqual([`${THU} lunch`, `${THU} evening`, `${FRI} lunch`, `${FRI} evening`]);
    const res = await addBlock(one(THU, 'lunch'));
    expect(res.status).toBe(201);
    const lunchId = await idOf(res);
    expect(await idOf(await addBlock(one(THU, 'lunch')))).toBe(lunchId); // pr59 L2, per window
    expect(await pickerOpen()).toEqual([`${THU} evening`, `${FRI} lunch`, `${FRI} evening`]);
    expect(await stateOf()).toEqual({
      [`${THU} lunch`]: ['blocked', 'window'],
      [`${THU} evening`]: ['open', null],
      [`${FRI} lunch`]: ['open', null],
      [`${FRI} evening`]: ['open', null],
    });
    const view = (await seasonView(BEFORE_SEASON)).weeks.find((w) => w.weekStart === WEEK)!;
    expect(view.blocks).toEqual([expect.objectContaining({ id: lunchId, startDate: THU, window: 'lunch' })]);

    // The per-date editor's request (no window, or window null) is the whole day, as before: it wins.
    const dayId = await idOf(await addBlock({ startDate: THU, endDate: THU, kind: 'blocked' }));
    expect(dayId).not.toBe(lunchId);
    expect(await idOf(await addBlock(one(THU, null)))).toBe(dayId);
    expect(await pickerOpen()).toEqual([`${FRI} lunch`, `${FRI} evening`]);
    const both = (await weekWindows()).body.windows!.filter((w) => w.date === THU);
    expect(both.map((w) => [w.state, w.block])).toEqual([
      ['blocked', { id: dayId, scope: 'day' }],
      ['blocked', { id: dayId, scope: 'day' }],
    ]);
    const dayView = (await seasonView(BEFORE_SEASON)).weeks.find((w) => w.weekStart === WEEK)!;
    expect(dayView.blocks.find((b) => b.id === dayId)).not.toHaveProperty('window');

    expect((await removeBlock(dayId)).status).toBe(200);
    expect((await stateOf())[`${THU} lunch`]).toEqual(['blocked', 'window']);
    expect((await removeBlock(lunchId)).status).toBe(200);
    expect(await pickerOpen()).toHaveLength(4);
  });

  it('an away range shows as away per window; a non-season week is 404', async () => {
    const away = await addBlock({
      startDate: WEEK,
      endDate: '2027-04-25',
      kind: 'away',
      confirmBy: '2027-04-27',
    });
    expect(away.status).toBe(201);
    expect(Object.values(await stateOf())).toEqual(Array(4).fill(['away', 'day']));
    await removeBlock(await idOf(away));
    expect((await weekWindows('2027-08-02')).status).toBe(404);
    expect((await weekWindows('not-a-date')).status).toBe(404);
  });
});

describe('T2.5.06 the lock path and the preview per window', () => {
  it('a lock into a blocked window is refused; the open window of the day locks', async () => {
    const blocked = await idOf(await addBlock(one(FRI, 'evening')));
    const a = await newRequest({ name: 'Window Lock A' });
    const b = await newRequest({ name: 'Window Lock B' });
    const lock = (id: string, w: 'lunch' | 'evening', bookAnyway = false) =>
      slotId(FRI, w).then((s) =>
        lockRequest({ requestId: id, target: { slotId: s }, mode: 'lock', bookAnyway, now: BEFORE_SEASON }),
      );
    expect(await lock(a, 'evening')).toMatchObject({ ok: false, status: 409, reason: 'blocked' });
    expect(await lock(a, 'lunch')).toMatchObject({ ok: true });
    // A range (dates mode) across the blocked evening is refused too; Book anyway still goes ahead.
    const range = {
      startsAt: new Date('2027-04-24T01:00:00Z'),
      endsAt: new Date('2027-04-24T03:00:00Z'),
      where: null,
    };
    const byRange = await lockRequest({ requestId: b, target: range, mode: 'lock', now: BEFORE_SEASON });
    expect(byRange).toMatchObject({ ok: false, reason: 'blocked' });
    expect(await lock(b, 'evening', true)).toMatchObject({ ok: true });
    await removeBlock(blocked);
    await q(`update request set status = 'cancelled', cancelled_at = now() where id = any($1::uuid[])`, [
      [a, b],
    ]);
  });

  it('the preview and POST /blocks name only the bookings in that window; validation (400)', async () => {
    const id = await newRequest({ name: 'Window Preview' });
    await lockDirect(id, { slotId: await slotId(THU, 'lunch') });
    const affected = async (qs: Record<string, string>) => {
      const res = await preview(qs);
      expect(res.status).toBe(200);
      return ((await res.json()) as { affected: { id: string }[] }).affected.map((x) => x.id);
    };
    expect(await affected({ startDate: THU, endDate: THU, window: 'lunch' })).toEqual([id]);
    expect(await affected({ startDate: THU, endDate: THU, window: 'evening' })).toEqual([]);
    expect(await affected({ startDate: THU, endDate: THU })).toEqual([id]);
    expect(await affected({ startDate: THU, endDate: THU, window: '' })).toEqual([id]);
    expect((await preview({ startDate: THU, endDate: FRI, window: 'lunch' })).status).toBe(400);
    expect((await preview({ startDate: THU, endDate: THU, window: 'brunch' })).status).toBe(400);
    // pr85 L1: a window preview on a day with no windows (Sat) is refused, as POST /blocks refuses it.
    expect((await preview({ startDate: '2027-04-24', endDate: '2027-04-24', window: 'lunch' })).status).toBe(
      400,
    );
    expect((await preview({ startDate: '2027-04-24', endDate: '2027-04-24' })).status).toBe(200);

    const over = await addBlock(one(THU, 'lunch'));
    expect(over.status).toBe(409);
    expect(await over.json()).toMatchObject({ code: 'locked_bookings', affected: [{ id }] });
    const evening = await addBlock(one(THU, 'evening'));
    expect(evening.status).toBe(201);
    await removeBlock(await idOf(evening));

    // Confirm the lunch block: an offered time in that window is refused (in_block); the evening is fine.
    const confirm = (slotIds: string[]) =>
      confirmRoute(
        req('POST', '/api/admin/season/blocks/confirm', {
          block: one(THU, 'lunch'),
          bookings: [{ requestId: id, slotIds }],
        }),
      );
    const inBlock = await confirm([await slotId(THU, 'lunch')]);
    expect(inBlock.status).toBe(409);
    expect(await inBlock.json()).toMatchObject({ code: 'in_block' });
    const friEvening = await idOf(await addBlock(one(FRI, 'evening')));
    const inOther = await confirm([await slotId(FRI, 'evening')]);
    expect(inOther.status).toBe(409);
    expect(await inOther.json()).toMatchObject({ code: 'in_block' });
    const ok = await confirm([await slotId(THU, 'evening'), await slotId(FRI, 'lunch')]);
    expect(ok.status).toBe(201);
    const done = (await ok.json()) as { id: string; moved: string[] };
    expect(done.moved).toEqual([id]);
    const row = (await q<{ status: string }>(`select status from request where id = $1`, [id]))[0]!;
    expect(row.status).toBe('needs_new_time');
    expect(await stateOf()).toMatchObject({
      [`${THU} lunch`]: ['blocked', 'window'],
      [`${THU} evening`]: ['open', null],
      [`${FRI} evening`]: ['blocked', 'window'],
    });
    await removeBlock(friEvening);
    await removeBlock(done.id);
  });

  it('the engine loader carries a window block with its slot times', async () => {
    const id = await idOf(await addBlock(one(FRI, 'lunch')));
    const loaded = await loadEngineData(BEFORE_SEASON);
    const s = loaded.slots.find((x) => x.date === FRI && x.windowKind === 'lunch')!;
    expect(loaded.blocks.filter((b) => b.window)).toEqual([
      expect.objectContaining({
        startDate: FRI,
        window: 'lunch',
        windowRange: { startsAt: s.startsAt, endsAt: s.endsAt },
      }),
    ]);
    await removeBlock(id);
  });
});
