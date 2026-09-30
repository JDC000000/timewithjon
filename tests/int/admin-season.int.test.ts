// T2.5 AC1, AC2 and the AC3 pre-check (a block or away range over a locked booking is refused with the list
// of affected bookings) + the T2.5.03 season view, against the test DB through the /api/admin/season routes.
// Each test uses its own season week; afterAll removes every block, override and request made here.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { pool, q } from '@/lib/db';
import { loadEngineData, engineInput } from '@/features/availability/load';
import { openWindows } from '@/features/availability';
import { seasonView } from '@/features/admin/season-view';
import { block } from '@/features/admin/season';
import { vancouverInstant } from '@/lib/time';
import { GET as seasonRoute } from '@/app/api/admin/season/route';
import { POST as blocksRoute } from '@/app/api/admin/season/blocks/route';
import { GET as previewRoute } from '@/app/api/admin/season/blocks/preview/route';
import { DELETE as blockRoute } from '@/app/api/admin/season/blocks/[id]/route';
import { PATCH as weekRoute } from '@/app/api/admin/season/weeks/[weekStart]/route';
import { POST as holdRoute } from '@/app/api/admin/season/household-hold/route';
import { cancelMade, joinDirect, lockDirect, newRequest, slotId } from '../fixtures/requests-db';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
const BEFORE_SEASON = new Date('2027-03-10T18:00:00Z'); // after both release times, before the season

afterAll(async () => {
  await q(`delete from availability_block`);
  await q(`update week set cap_override = null`);
  await q(`update settings set household_hold_released = false`);
  await cancelMade();
  await pool().end();
});

const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`${SITE}${path}`, {
    method,
    headers: { origin: SITE, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = <T>(p: T) => ({ params: Promise.resolve(p) });
const addBlock = (b: Record<string, unknown>) => blocksRoute(req('POST', '/api/admin/season/blocks', b));

async function picker(dishWindows: ('lunch' | 'evening')[] = ['lunch', 'evening']) {
  return openWindows(engineInput(await loadEngineData(BEFORE_SEASON), [], 'general', dishWindows));
}
const clock = async () => (await q<{ t: Date }>(`select clock_timestamp() t`))[0]!.t;
const auditSince = async (t0: Date, like: string) =>
  (
    await q<{ action: string }>(
      `select action from audit_log where actor = 'jon' and action like $2 and at >= $1 order by at, id`,
      [t0, like],
    )
  ).map((a) => a.action);
const weekOut = async (weekStart: string) => (await picker()).weeks.find((w) => w.weekStart === weekStart)!;

describe('T2.5 AC1: a block hides its windows from the picker immediately', () => {
  it('a day block removes that day only; unblocking brings it back', async () => {
    const t0 = (await q<{ t: Date }>(`select clock_timestamp() t`))[0]!.t;
    expect((await weekOut('2027-05-03')).windows.map((w) => w.date)).toContain('2027-05-06');
    const res = await addBlock({ startDate: '2027-05-06', endDate: '2027-05-06', kind: 'blocked' });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { id } = (await res.json()) as { id: string };
    const dates = (await weekOut('2027-05-03')).windows.map((w) => w.date);
    expect(dates).not.toContain('2027-05-06');
    expect(dates).toContain('2027-05-07');

    const del = await blockRoute(req('DELETE', `/api/admin/season/blocks/${id}`), params({ id }));
    expect(del.status).toBe(200);
    expect((await weekOut('2027-05-03')).windows.map((w) => w.date)).toContain('2027-05-06');
    const again = await blockRoute(req('DELETE', `/api/admin/season/blocks/${id}`), params({ id }));
    expect(again.status).toBe(404);
    const actions = await q<{ action: string }>(
      `select action from audit_log where actor = 'jon' and action like 'block_%' and at >= $1 order by at`,
      [t0],
    );
    expect(actions.map((a) => a.action)).toEqual(['block_added', 'block_removed']);
  });

  it('a week block makes the week spoken for (not away), so stand-by stays on offer', async () => {
    const res = await addBlock({ startDate: '2027-04-26', endDate: '2027-05-02', kind: 'blocked' });
    expect(res.status).toBe(201);
    const w = await weekOut('2027-04-26');
    expect(w.state).toBe('spoken_for');
    expect(w.windows).toEqual([]);
    expect((await picker()).awayNotice).toBeUndefined();
  });
});

describe('T2.5 AC2: away mode shows its notice in S6', () => {
  it('an away range over a whole week makes it away, with the notice and confirm-by date', async () => {
    const res = await addBlock({
      startDate: '2027-04-19',
      endDate: '2027-04-25',
      kind: 'away',
      confirmBy: '2027-04-01',
      note: 'Tofino',
    });
    expect(res.status).toBe(201);
    const out = await picker();
    expect(out.weeks.find((w) => w.weekStart === '2027-04-19')!.state).toBe('away');
    expect(out.awayNotice).toEqual({ until: '2027-04-25', confirmBy: '2027-04-01' });
    const blocks = await q<{ note: string; confirm_by: string }>(
      `select note, confirm_by::text from availability_block where kind = 'away'`,
    );
    expect(blocks).toEqual([{ note: 'Tofino', confirm_by: '2027-04-01' }]);
  });

  it('adding and removing an away range is audited as away_added / away_removed', async () => {
    const t0 = await clock();
    const res = await addBlock({
      startDate: '2027-06-21',
      endDate: '2027-06-27',
      kind: 'away',
      confirmBy: '2027-06-01',
    });
    const { id } = (await res.json()) as { id: string };
    expect((await blockRoute(req('DELETE', '/x'), params({ id }))).status).toBe(200);
    expect(await auditSince(t0, 'away_%')).toEqual(['away_added', 'away_removed']);
  });
});

describe('T2.5 AC3 pre-check: a block over a locked booking is refused with the affected list', () => {
  it('lists the host with its joined guests, inserts nothing, and the preview says the same', async () => {
    const host = await newRequest({ name: 'Host Guest' });
    await lockDirect(host, { slotId: await slotId('2027-05-20', 'lunch') });
    const joined = await newRequest({ name: 'Joined Guest' });
    await joinDirect(joined, host);
    const before = Number((await q<{ n: string }>(`select count(*) n from availability_block`))[0]!.n);

    for (const kind of ['blocked', 'away'] as const) {
      const confirmBy = kind === 'away' ? '2027-05-01' : undefined;
      const res = await addBlock({ startDate: '2027-05-17', endDate: '2027-05-23', kind, confirmBy });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string; affected: { id: string; joinedGuests: number }[] };
      expect(body.code).toBe('locked_bookings');
      expect(body.affected).toEqual([expect.objectContaining({ id: host, joinedGuests: 1 })]);
    }
    expect(Number((await q<{ n: string }>(`select count(*) n from availability_block`))[0]!.n)).toBe(before);

    const prev = await previewRoute(
      req('GET', '/api/admin/season/blocks/preview?startDate=2027-05-20&endDate=2027-05-20'),
    );
    expect(((await prev.json()) as { affected: { id: string }[] }).affected.map((a) => a.id)).toEqual([host]);
    // The day after is free: a block there goes through.
    const res = await addBlock({ startDate: '2027-05-21', endDate: '2027-05-21', kind: 'blocked' });
    expect(res.status).toBe(201);
  });

  it('catches a range reaching in from the day before; a booking ending at local midnight does not count', async () => {
    const overnight = await newRequest();
    await lockDirect(overnight, {
      startsAt: vancouverInstant('2027-06-12', '10:00'),
      endsAt: vancouverInstant('2027-06-13', '16:00'),
    });
    const toMidnight = await newRequest();
    await lockDirect(toMidnight, {
      startsAt: vancouverInstant('2027-06-15', '18:00'),
      endsAt: vancouverInstant('2027-06-16', '00:00'),
    });
    const r1 = await addBlock({ startDate: '2027-06-13', endDate: '2027-06-13', kind: 'blocked' });
    expect(r1.status).toBe(409);
    const r2 = await addBlock({ startDate: '2027-06-16', endDate: '2027-06-16', kind: 'blocked' });
    expect(r2.status).toBe(201);
  });

  it('a booking that has already ended (lazy done) is never affected', async () => {
    const past = await newRequest();
    await lockDirect(past, { slotId: await slotId('2027-06-17', 'evening') });
    expect(
      (
        await block({
          startDate: '2027-06-17',
          endDate: '2027-06-17',
          kind: 'away',
          confirmBy: '2027-06-01',
          note: null,
        })
      ).ok,
    ).toBe(false);
    const res = await block(
      { startDate: '2027-06-17', endDate: '2027-06-17', kind: 'away', confirmBy: '2027-06-01', note: null },
      new Date('2027-06-18T12:00:00Z'),
    );
    expect(res.ok).toBe(true);
  });
});

describe('T2.5.01 serialises with the lock path', () => {
  it('waits for a lock holding the week row, including the week before (a range reaching in)', async () => {
    const other = await pool().connect();
    try {
      await other.query('begin');
      // What lockRequest() holds while it locks a booking starting on Sun May 30 (week of May 24).
      await other.query(`select 1 from week where week_start = '2027-05-24' for update`);
      let settled = false;
      const pending = block({
        startDate: '2027-05-31',
        endDate: '2027-05-31',
        kind: 'blocked',
        confirmBy: null,
        note: null,
      }).finally(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false);
      await other.query('commit');
      expect((await pending).ok).toBe(true);
    } finally {
      other.release();
    }
  });
});

describe('T2.5.01 serialises with the lock path on a week with no row (review L3)', () => {
  it('waits for the advisory lock lock.ts takes for a missing week row', async () => {
    const other = await pool().connect();
    try {
      await other.query('begin');
      // Mar 22 has no week row; a block from Mar 25 reaches back to it (a 72 h booking starting Mar 22-24).
      await other.query(`select pg_advisory_xact_lock(hashtext('twj_week:' || '2027-03-22'))`);
      let settled = false;
      const pending = block({
        startDate: '2027-03-25',
        endDate: '2027-04-01',
        kind: 'blocked',
        confirmBy: null,
        note: null,
      }).finally(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false);
      await other.query('commit');
      const res = await pending;
      expect(res.ok).toBe(true);
      if (res.ok) await q(`delete from availability_block where id = $1`, [res.id]); // frees Apr 1 again
    } finally {
      other.release();
    }
  });
});

describe('T2.5.01 validation', () => {
  it.each([
    [{ startDate: '2027-05-07', endDate: '2027-05-06', kind: 'blocked' }],
    [{ startDate: '2027-05-06', endDate: '2027-05-06', kind: 'away' }], // away needs its confirm-by date (L2)
    [{ startDate: '2027-05-06', endDate: '2027-05-06', kind: 'away', confirmBy: null }],
    [{ startDate: '2027-05-06', endDate: '2027-05-06', kind: 'blocked', confirmBy: '2027-05-01' }],
    [{ startDate: '2027-05-06', endDate: '2027-05-06', kind: 'closed' }],
    [{ startDate: '2027-05-06', endDate: '2027-05-06', kind: 'blocked', extra: 1 }],
    [{ startDate: '2027-02-30', endDate: '2027-05-06', kind: 'blocked' }],
    [{ startDate: '2027-05-06', endDate: '2027-05-06', kind: 'blocked', note: 'x'.repeat(201) }],
  ])('refuses a bad block body %#', async (b) => {
    expect((await addBlock(b)).status).toBe(400);
  });

  it('refuses a range wholly outside the season, accepts one that overlaps it', async () => {
    const out = await addBlock({
      startDate: '2027-07-01',
      endDate: '2027-07-05',
      kind: 'away',
      confirmBy: '2027-06-01',
    });
    expect(out.status).toBe(400);
    expect(((await out.json()) as { code: string }).code).toBe('out_of_season');
    expect(
      (
        await addBlock({
          startDate: '2027-03-20',
          endDate: '2027-03-31',
          kind: 'away',
          confirmBy: '2027-03-01',
        })
      ).status,
    ).toBe(400);
    const edge = await addBlock({ startDate: '2027-03-25', endDate: '2027-04-01', kind: 'blocked' });
    expect(edge.status).toBe(201);
    const { id } = (await edge.json()) as { id: string };
    await blockRoute(req('DELETE', `/api/admin/season/blocks/${id}`), params({ id })); // frees Apr 1 again
    expect((await addBlock({ startDate: '2027-06-30', endDate: '2027-07-04', kind: 'blocked' })).status).toBe(
      201,
    );
  });

  it('a bad id or a bad week is a 404; a bad preview query is a 400', async () => {
    expect((await blockRoute(req('DELETE', '/x'), params({ id: 'nope' }))).status).toBe(404);
    expect((await weekRoute(req('PATCH', '/x', { capOverride: 3 }), params({ weekStart: 'x' }))).status).toBe(
      404,
    );
    const tue = await weekRoute(req('PATCH', '/x', { capOverride: 3 }), params({ weekStart: '2027-05-25' }));
    expect(tue.status).toBe(404);
    for (const qs of ['', '?startDate=2027-05-06', '?startDate=2027-05-07&endDate=2027-05-06']) {
      expect((await previewRoute(req('GET', `/api/admin/season/blocks/preview${qs}`))).status).toBe(400);
    }
  });
});

describe('T2.5.01 cap override and household hold', () => {
  it('sets, validates and clears a cap override', async () => {
    const t0 = await clock();
    const patch = (b: unknown) => weekRoute(req('PATCH', '/x', b), params({ weekStart: '2027-05-24' }));
    expect((await patch({ capOverride: 3 })).status).toBe(200);
    let w = (await seasonView()).weeks.find((x) => x.weekStart === '2027-05-24')!;
    expect([w.capOverride, w.cap]).toEqual([3, 3]);
    for (const bad of [
      { capOverride: 11 },
      { capOverride: -1 },
      { capOverride: 1.5 },
      {},
      { capOverride: '3' },
    ]) {
      expect((await patch(bad)).status).toBe(400);
    }
    expect((await patch({ capOverride: 0 })).status).toBe(200);
    w = (await seasonView()).weeks.find((x) => x.weekStart === '2027-05-24')!;
    expect([w.capOverride, w.cap]).toEqual([0, 0]);
    expect((await weekOut('2027-05-24')).state).toBe('spoken_for');
    expect((await patch({ capOverride: null })).status).toBe(200);
    w = (await seasonView()).weeks.find((x) => x.weekStart === '2027-05-24')!;
    expect([w.capOverride, w.cap]).toEqual([null, 2]);
    expect(await auditSince(t0, 'cap_override_%')).toEqual([
      'cap_override_set',
      'cap_override_set',
      'cap_override_cleared',
    ]);
  });

  it('releasing the household hold opens Thu Apr 1 lunch, once', async () => {
    await q(`update settings set household_hold_released = false`); // other files (dev scenarios) may release it
    const t0 = await clock();
    const apr1Lunch = await slotId('2027-04-01', 'lunch');
    const has = async () =>
      (await picker(['lunch'])).weeks.flatMap((w) => w.windows).some((x) => x.slotId === apr1Lunch);
    expect(await has()).toBe(false);
    const first = await holdRoute(req('POST', '/api/admin/season/household-hold'));
    expect(await first.json()).toEqual({ ok: true, changed: true });
    expect(await has()).toBe(true);
    const second = await holdRoute(req('POST', '/api/admin/season/household-hold'));
    expect(await second.json()).toEqual({ ok: true, changed: false });
    expect((await seasonView()).householdHoldReleased).toBe(true);
    expect(await auditSince(t0, 'household_%')).toEqual(['household_hold_released']); // audited once
  });
});

describe('T2.5.03 season view', () => {
  it('per week: locked and lazily-done bookings, pending taps, stand-by, blocks and the cap used', async () => {
    const wk = '2027-04-05'; // Thu Apr 8, Fri Apr 9
    const locked = await newRequest({ name: 'Locked One' });
    await lockDirect(locked, { slotId: await slotId('2027-04-08', 'lunch') });
    const joined = await newRequest({ name: 'Joined One' });
    await joinDirect(joined, locked);
    const gone = await newRequest({ name: 'Joined Then Cancelled' }); // L5: never counted as a joined guest
    await joinDirect(gone, locked);
    await q(`update request set status = 'cancelled', cancelled_at = now() where id = $1`, [gone]);
    // F1: a locked spam suspect is not listed but still counts toward the cap, as the engine counts it.
    const spamLocked = await newRequest({ name: 'Spam Locked', spam: true });
    await lockDirect(spamLocked, { slotId: await slotId('2027-04-08', 'evening') });
    const tapper = await newRequest({
      name: 'Tapper',
      slotIds: [await slotId('2027-04-09', 'lunch'), await slotId('2027-04-09', 'evening')],
    });
    const spamTapper = await newRequest({
      name: 'Spam',
      slotIds: [await slotId('2027-04-09', 'lunch')],
      spam: true,
    });
    const waiting = await newRequest({ name: 'Waiting', standbyWeek: wk });
    await addBlock({ startDate: '2027-04-10', endDate: '2027-04-12', kind: 'blocked' });

    const view = await seasonView(new Date('2027-03-01T00:00:00Z'));
    expect(view.weeks).toHaveLength(14);
    const w = view.weeks.find((x) => x.weekStart === wk)!;
    expect(w.bookings).toEqual([
      expect.objectContaining({ id: locked, status: 'locked', joinedGuests: 1, dishName: 'The Long Lunch' }),
    ]);
    expect(w.capUsed).toBe(2);
    expect(w.pendingTaps.map((p) => [p.id, p.taps.length])).toEqual([[tapper, 2]]);
    expect(w.pendingTaps.some((p) => p.id === spamTapper)).toBe(false);
    expect(w.standby.map((s) => s.id)).toEqual([waiting]);
    expect(w.blocks.map((b) => [b.startDate, b.endDate])).toEqual([['2027-04-10', '2027-04-12']]);
    // The block reaches into the next week too; the joined guest is never a booking of its own.
    expect(view.weeks.find((x) => x.weekStart === '2027-04-12')!.blocks).toHaveLength(1);
    expect(view.weeks.flatMap((x) => x.bookings).some((b) => b.id === joined)).toBe(false);

    const later = await seasonView(new Date('2027-04-08T21:00:00Z')); // 14:00 Vancouver, lunch over
    expect(later.weeks.find((x) => x.weekStart === wk)!.bookings[0]!.status).toBe('done');

    const res = await seasonRoute(req('GET', '/api/admin/season'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text).not.toMatch(/surprise|sealed/i);
  });
});
