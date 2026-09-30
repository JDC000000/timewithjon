// T5.1.02 (TSD T5.1 AC2) against the test DB through POST /api/admin/invites/import: "The import never touches
// our_things, which Jon always types himself." A CSV with an our_things column is refused, imported rows have
// our_things = '{}', no admin session is a 401, and a bad dish row is a 400 with 0 rows written. afterAll deletes
// every invite made here (they all carry this run's tag in their name).
import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { pool, q } from '@/lib/db';
import { currentAuthEmail } from '@/features/admin/supabase';
import { POST as importRoute } from '@/app/api/admin/invites/import/route';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
const TAG = `Imp${randomUUID().slice(0, 6)}`;

afterAll(async () => {
  await q(`delete from invite where display_name like $1`, [`${TAG}%`]);
  await pool().end();
});

const post = (csv: string, type = 'text/csv') =>
  importRoute(
    new NextRequest(`${SITE}/api/admin/invites/import`, {
      method: 'POST',
      headers: { origin: SITE, 'content-type': type },
      body: csv,
    }),
  );
const mine = () =>
  q<{
    display_name: string;
    our_things: string;
    picked_dish: string | null;
    prefill_email: string | null;
    kind: string;
  }>(
    `select display_name, our_things::text as our_things, picked_dish, prefill_email::text as prefill_email, kind
       from invite where display_name like $1 order by display_name`,
    [`${TAG}%`],
  );

describe('POST /api/admin/invites/import (T5.1 AC2)', () => {
  it('no admin session: 401, nothing written', async () => {
    vi.mocked(currentAuthEmail).mockResolvedValueOnce(null);
    const res = await post(`name\n${TAG} Nobody\n`);
    expect(res.status).toBe(401);
    expect(await mine()).toEqual([]);
  });

  it('refuses a CSV with an our_things column: 400, 0 rows written', async () => {
    const res = await post(`name,email,dish,our_things\n${TAG} Sneaky,,,"skiing, pints"\n`);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { errors: { line: number; reason: string }[] };
    expect(json.errors).toEqual([{ line: 1, reason: 'unknown_column:our_things' }]);
    expect(await mine()).toEqual([]);
  });

  it('a bad dish row: 400 naming the line, and 0 rows written (the good rows too)', async () => {
    const res = await post(`name,dish\n${TAG} Good,the-long-lunch\n${TAG} Bad,no-such-dish\n`);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; errors: { line: number; reason: string }[] };
    expect(json.ok).toBe(false);
    expect(json.errors).toEqual([{ line: 3, reason: 'dish:not_bookable' }]);
    expect(await mine()).toEqual([]);
  });

  it('a body that is not text/csv: 415', async () => {
    expect((await post(`name\n${TAG} Json\n`, 'application/json')).status).toBe(415);
    expect(await mine()).toEqual([]);
  });

  it('imports one personal invite per row with our_things = {} (email and dish optional)', async () => {
    const res = await post(
      `name,email,dish\r\n${TAG} A,a@example.com,the-long-lunch\r\n${TAG} B,,\r\n"${TAG} C, Jr",,the-flat-white\r\n`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true, created: 3 });
    expect(await mine()).toEqual([
      {
        display_name: `${TAG} A`,
        our_things: '{}',
        picked_dish: 'the-long-lunch',
        prefill_email: 'a@example.com',
        kind: 'personal',
      },
      {
        display_name: `${TAG} B`,
        our_things: '{}',
        picked_dish: null,
        prefill_email: null,
        kind: 'personal',
      },
      {
        display_name: `${TAG} C, Jr`,
        our_things: '{}',
        picked_dish: 'the-flat-white',
        prefill_email: null,
        kind: 'personal',
      },
    ]);
  });
});
