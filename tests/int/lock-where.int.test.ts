// evals/bugs: lock-sheet-no-place (r6): a place set on the lock reaches the guest. lockRequest with a range and a
// `where` (what the Lock sheet's new Where field sends) stores it, and the guest's E4 says "Where: {where}." in place
// of "You pick the place…". A guest joined to that booking gets the host's place in their E4. No place: as before.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { pool, q } from '@/lib/db';
import { lockRequest } from '@/features/requests/lock';
import { joinToBooking } from '@/features/requests/joined';
import { vancouverInstant } from '@/lib/time';
import { made, newRequest, removeRequests } from '../fixtures/requests-db';

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
      target: { ...range('2027-06-19'), where: 'Lynn Canyon parking lot' },
      mode: 'lock',
    });
    expect(res).toMatchObject({ ok: true });
    expect((await q<{ w: string }>(`select locked_where as w from request where id = $1`, [id]))[0]!.w).toBe(
      'Lynn Canyon parking lot',
    );
    const mail = await e4(id);
    expect(mail).toContain('Where: Lynn Canyon parking lot.');
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
