// QA4 H1: Lock in's read-only pre-check (src/features/admin/lock-check.ts, POST /api/admin/requests/[id]/lock-check)
// against the test DB. A date dish in a full week is refused with the booking it would be (nth), passes with
// Override this week, a blocked date asks for Book anyway, and nothing is written either way. Week of Mon
// 2027-06-14 (no other int test uses it); afterAll removes every row made here.
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool, q } from '@/lib/db';
import { vancouverInstant } from '@/lib/time';
import { checkLock } from '@/features/admin/lock-check';
import { POST as lockCheckRoute } from '@/app/api/admin/requests/[id]/lock-check/route';
import { removeRequests } from '../fixtures/requests-db';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
const made: string[] = [];
const blocks: string[] = [];
let inviteId = '';

async function request(cols: Record<string, unknown>): Promise<string> {
  const [g] = await q<{ id: string }>(`insert into guest (email) values ($1) returning id`, [
    `lockcheck+${randomUUID().slice(0, 8)}@example.com`,
  ]);
  const base: Record<string, unknown> = {
    is_test: true,
    client_key: randomUUID(),
    guest_id: g!.id,
    invite_id: inviteId,
    contact_name: 'Lock Check',
    contact_email: `lc-${randomUUID().slice(0, 8)}@example.com`,
    dish: 'the-encore',
    mode: 'dates',
    counts_toward: 'weekly_cap',
    status: 'requested',
    ...cols,
  };
  const keys = Object.keys(base);
  const [row] = await q<{ id: string }>(
    `insert into request (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    keys.map((k) => base[k]),
  );
  made.push(row!.id);
  return row!.id;
}
const locked = (date: string) =>
  request({
    status: 'locked',
    locked_starts_at: vancouverInstant(date, '19:00'),
    locked_ends_at: vancouverInstant(date, '22:00'),
  });
const encoreOn = (date: string) => ({
  startsAt: vancouverInstant(date, '19:00'),
  endsAt: vancouverInstant(date, '22:00'),
  countsToward: 'weekly_cap' as const,
  where: null,
});
const NO = { overrideWeek: false, bookAnyway: false };
const rowOf = async (id: string) =>
  (
    await q<{ status: string; audits: number }>(
      `select status, (select count(*)::int from audit_log where request_id = r.id) as audits from request r where id = $1`,
      [id],
    )
  )[0]!;

beforeAll(async () => {
  inviteId = (await q<{ id: string }>(`select id from invite where kind = 'general'`))[0]!.id;
});
afterAll(async () => {
  await q(`delete from availability_block where id = any($1::uuid[])`, [blocks]);
  await removeRequests(made);
  await pool().end();
});

describe('checkLock (QA4 H1)', () => {
  it('a date dish in a full week: week_full with "the 3rd"; Override this week passes; nothing is written', async () => {
    await locked('2027-06-15');
    await locked('2027-06-16');
    const id = await request({});
    expect(await checkLock(id, encoreOn('2027-06-17'), NO)).toEqual({
      ok: false,
      reason: 'week_full',
      message: 'That week is full. Tick Override this week to go ahead.',
      nth: 3,
    });
    expect(await checkLock(id, encoreOn('2027-06-17'), { ...NO, overrideWeek: true })).toEqual({
      ok: true,
      warnings: [],
    });
    expect(await rowOf(id)).toEqual({ status: 'requested', audits: 0 }); // read only
  });

  it('a blocked date asks for Book anyway, and passes with it', async () => {
    const [b] = await q<{ id: string }>(
      `insert into availability_block (start_date, end_date, kind) values ('2027-06-19', '2027-06-19', 'blocked') returning id`,
    );
    blocks.push(b!.id);
    const id = await request({ counts_toward: 'none' });
    const target = { ...encoreOn('2027-06-19'), countsToward: 'none' as const };
    expect(await checkLock(id, target, NO)).toMatchObject({ ok: false, reason: 'blocked', nth: null });
    expect(await checkLock(id, target, { ...NO, bookAnyway: true })).toMatchObject({ ok: true });
  });

  it('ENG-11: on a Big Day Sunday an Encore that evening, or a second Big Day, asks for Book anyway and passes with it', async () => {
    await request({
      dish: 'the-grind',
      counts_toward: 'big_day',
      status: 'locked',
      locked_starts_at: vancouverInstant('2027-06-20', '07:00'),
      locked_ends_at: vancouverInstant('2027-06-20', '12:00'),
    });
    const clash = {
      ok: false,
      reason: 'big_day_clash',
      message: 'That day already has a booking. Tick Book anyway to go ahead.',
      nth: null,
    };
    const encore = await request({ counts_toward: 'none' });
    const evening = { ...encoreOn('2027-06-20'), countsToward: 'none' as const };
    expect(await checkLock(encore, evening, NO)).toEqual(clash);
    expect(await checkLock(encore, evening, { ...NO, bookAnyway: true })).toMatchObject({ ok: true });
    const ride = await request({ dish: 'the-shore-ride', counts_toward: 'big_day' });
    const afternoon = {
      startsAt: vancouverInstant('2027-06-20', '13:00'),
      endsAt: vancouverInstant('2027-06-20', '17:00'),
      countsToward: 'big_day' as const,
      where: null,
    };
    expect(await checkLock(ride, afternoon, NO)).toEqual(clash);
    expect(await checkLock(ride, afternoon, { ...NO, bookAnyway: true })).toMatchObject({ ok: true });
  });

  it('the route: admin + Origin, the lock body, the verdict back, never cached; a missing request is a 404', async () => {
    const id = await request({});
    const post = (rid: string, body: unknown) =>
      lockCheckRoute(
        new NextRequest(`${SITE}/api/admin/requests/${rid}/lock-check`, {
          method: 'POST',
          headers: { origin: SITE, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: rid }) },
      );
    const body = { date: '2027-06-17', start: '19:00', lengthMinutes: 180, countsToward: 'weekly_cap' };
    const res = await post(id, body);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: true, check: { ok: false, reason: 'week_full', nth: 3 } });
    const ok = await post(id, { ...body, overrideWeek: true });
    expect(await ok.json()).toMatchObject({ ok: true, check: { ok: true } });
    expect((await post(randomUUID(), body)).status).toBe(404);
    expect((await post(id, { date: 'nope' })).status).toBe(400);
    expect(await rowOf(id)).toEqual({ status: 'requested', audits: 0 });
  });
});
