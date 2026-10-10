// evals/bugs: lock-sheet-no-place (r6): a place set on the lock reaches the guest. lockRequest with a range and a
// `where` (what the Lock sheet's new Where field sends) stores it, and the guest's E4 says "Where: {where}." in place
// of "You pick the place…". A guest joined to that booking gets the host's place in their E4. No place: as before.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { pool, q } from '@/lib/db';
import { lockRequest } from '@/features/requests/lock';
import { joinToBooking } from '@/features/requests/joined';
import { vancouverInstant } from '@/lib/time';
import { NextRequest } from 'next/server';
import { POST as lockRoute } from '@/app/api/admin/requests/[id]/lock/route';
import { made, newRequest, removeRequests, slotId } from '../fixtures/requests-db';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

afterAll(async () => {
  await removeRequests(made);
  await pool().end();
});

/** The E4 as the prototype's mailer sent it (dev_outbox), for this request's guest. */
const e4 = async (id: string) =>
  (
    await q<{ text_body: string }>(
      `select d.text_body from dev_outbox d join request r on r.contact_email = d.to_email
        where r.id = $1 and d.template = 'E4' order by d.created_at desc limit 1`,
      [id],
    )
  )[0]?.text_body ?? '';

const range = (date: string) => ({
  startsAt: vancouverInstant(date, '10:00'),
  endsAt: vancouverInstant(date, '12:00'),
  countsToward: 'none' as const,
});

describe('a place on the lock (r6)', () => {
  it('is stored, and the E4 says "Where: …." instead of "You pick the place"', async () => {
    const id = await newRequest({ dish: 'the-grind' });
    const res = await lockRequest({
      requestId: id,
      target: { ...range('2027-06-19'), where: 'North gate' },
      mode: 'lock',
    });
    expect(res).toMatchObject({ ok: true });
    expect((await q<{ w: string }>(`select locked_where as w from request where id = $1`, [id]))[0]!.w).toBe(
      'North gate',
    );
    const mail = await e4(id);
    expect(mail).toContain('Where: North gate.');
    expect(mail).not.toContain('You pick the place');
  });

  it('a guest joined to that booking gets the host’s place', async () => {
    const host = await newRequest({ dish: 'the-grind', name: 'Host Guest' });
    await lockRequest({
      requestId: host,
      target: { ...range('2027-06-20'), where: 'The pier' },
      mode: 'lock',
    });
    const rider = await newRequest({ dish: 'the-grind', name: 'Rider Guest' });
    expect(await joinToBooking(rider, host)).toMatchObject({ ok: true });
    expect(await e4(rider)).toContain('Where: The pier.');
  });

  it('no place: nothing stored, and the E4 keeps "You pick the place"', async () => {
    const id = await newRequest({ dish: 'the-grind' });
    await lockRequest({ requestId: id, target: { ...range('2027-06-26'), where: null }, mode: 'lock' });
    expect(
      (await q<{ w: string | null }>(`select locked_where as w from request where id = $1`, [id]))[0]!.w,
    ).toBeNull();
    expect(await e4(id)).toContain('You pick the place');
  });
});

// evals/bugs: time-dish-no-place (TWJ11): the one-click time lock (POST /lock with a slotId) may carry the place too.
describe('a place on a one-click time lock (TWJ11)', () => {
  const SITE = 'http://localhost:3000';
  const post = (id: string, body: unknown) =>
    lockRoute(
      new NextRequest(`${SITE}/api/admin/requests/${id}/lock`, {
        method: 'POST',
        headers: { origin: SITE, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );

  it('with a place: stored, and the E4 says "Where: …."', async () => {
    const s = await slotId('2027-06-18', 'lunch');
    const id = await newRequest({ slotIds: [s] });
    const res = await post(id, { slotId: s, where: '  North gate ' });
    expect(res.status).toBe(200);
    expect((await q<{ w: string }>(`select locked_where as w from request where id = $1`, [id]))[0]!.w).toBe(
      'North gate',
    );
    expect(await e4(id)).toContain('Where: North gate.');
  });

  it('without one (the field left empty, or no key at all): the lock goes as before, no place', async () => {
    const a = await slotId('2027-05-20', 'lunch');
    const noKey = await newRequest({ slotIds: [a] });
    expect((await post(noKey, { slotId: a })).status).toBe(200);
    const b = await slotId('2027-05-21', 'evening');
    const empty = await newRequest({ slotIds: [b] });
    expect((await post(empty, { slotId: b, where: '' })).status).toBe(200);
    const places = await q<{ w: string | null }>(
      `select locked_where as w from request where id = any($1::uuid[])`,
      [[noKey, empty]],
    );
    expect(places).toEqual([{ w: null }, { w: null }]);
    expect(await e4(noKey)).toContain('You pick the place');
  });

  it('a place longer than 200 characters is refused (400), nothing locked', async () => {
    const s = await slotId('2027-06-18', 'evening');
    const id = await newRequest({ slotIds: [s] });
    expect((await post(id, { slotId: s, where: 'x'.repeat(201) })).status).toBe(400);
    expect((await q<{ status: string }>(`select status from request where id = $1`, [id]))[0]!.status).toBe(
      'requested',
    );
  });

  it('a guest joined to a time booking gets its place', async () => {
    const s = await slotId('2027-06-11', 'lunch');
    const host = await newRequest({ slotIds: [s], name: 'Host Guest' });
    expect((await post(host, { slotId: s, where: 'North gate' })).status).toBe(200);
    const rider = await newRequest({ slotIds: [s], name: 'Rider Guest' });
    expect(await joinToBooking(rider, host)).toMatchObject({ ok: true });
    expect(await e4(rider)).toContain('Where: North gate.');
  });
});
