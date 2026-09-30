// pr59-verify N2: moveBooking's backstop checks. Under confirmBlock's row locks they can't be reached (lockCandidates
// holds every row it moves), so requestForOffer is stubbed to report a row as still locked, or not, whatever the
// row really is: a throw is what rolls the whole confirm back.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { pool, q } from '@/lib/db';
import { moveBooking } from '@/features/admin/block-confirm';
import { noSideEffects } from '@/features/requests/side-effects';
import { cancelMade, lockDirect, newRequest, slotId } from '../fixtures/requests-db';

const seen = vi.hoisted(() => ({ status: 'locked' }));
vi.mock('@/lib/report', () => ({ report: vi.fn(), reportMessage: vi.fn() }));
vi.mock('@/features/requests/suggest', async (orig) => ({
  ...(await orig<typeof import('@/features/requests/suggest')>()),
  requestForOffer: vi.fn(async () => ({
    status: seen.status,
    dish: 'dosa',
    contact_email: 'belt@example.com',
    guest_time_zone: null,
    joined_to_request_id: null,
    counts_toward: 'weekly_cap',
  })),
}));

afterAll(async () => {
  await cancelMade();
  await pool().end();
});

/** moveBooking in a transaction that is always rolled back. */
async function move(id: string): Promise<unknown> {
  const c = await pool().connect();
  try {
    await c.query('begin');
    return await moveBooking(c, id, null, [], new Date('2027-01-01T00:00:00Z'), noSideEffects()).catch(
      (e: Error) => e,
    );
  } finally {
    await c.query('rollback');
    c.release();
  }
}

describe('pr59-verify N2: moveBooking refuses a row that is no longer locked', () => {
  it('throws when the row read under the lock is not locked', async () => {
    seen.status = 'cancelled';
    const id = await newRequest({ name: 'Block Belt Read' });
    expect(await move(id)).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/changed under the lock/) }),
    );
  });

  it('throws when the UPDATE finds the row no longer locked (AND status = locked, rowCount 1)', async () => {
    seen.status = 'locked';
    const id = await newRequest({ name: 'Block Belt Update' });
    await lockDirect(id, { slotId: await slotId('2027-06-10', 'evening') });
    await q(`update request set status = 'cancelled', cancelled_at = now() where id = $1`, [id]);
    expect(await move(id)).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/no longer locked/) }),
    );
    expect((await q<{ status: string }>(`select status from request where id = $1`, [id]))[0]!.status).toBe(
      'cancelled',
    );
  });
});
