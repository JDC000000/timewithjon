// T2.3.U1: the lock POST body and how each answer reads.
import { describe, expect, it, vi } from 'vitest';
import { ERRORS } from '@/content';
import type { ApiAnswer, Send } from './api';
import { sendLock } from './lock-logic';

function answering(a: ApiAnswer): { post: Send; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const post = vi.fn(async (...args: unknown[]) => {
    calls.push(args);
    return a;
  }) as unknown as Send;
  return { post, calls };
}

describe('sendLock', () => {
  it('posts the slot and both ticks (off by default) to lock', async () => {
    const a = answering({ status: 200, data: { warnings: [] } });
    await expect(sendLock('r1', { slotId: 's1' }, undefined, a.post)).resolves.toEqual({
      ok: true,
      standbyOfferLive: false,
    });
    expect(a.calls).toEqual([
      ['POST', '/api/admin/requests/r1/lock', { slotId: 's1', overrideWeek: false, bookAnyway: false }],
    ]);
    const b = answering({ status: 200, data: {} });
    await sendLock('r1', { slotId: 's2' }, { overrideWeek: true, bookAnyway: true }, b.post);
    expect(b.calls[0]).toEqual([
      'POST',
      '/api/admin/requests/r1/lock',
      { slotId: 's2', overrideWeek: true, bookAnyway: true },
    ]);
  });
  it('a dates-mode target goes as date, start and length', async () => {
    const a = answering({ status: 200, data: {} });
    await sendLock(
      'r1',
      { date: '2027-05-08', start: '09:00', lengthMinutes: 240, countsToward: 'big_day' },
      undefined,
      a.post,
    );
    expect(a.calls[0]![2]).toEqual({
      date: '2027-05-08',
      start: '09:00',
      lengthMinutes: 240,
      countsToward: 'big_day',
      overrideWeek: false,
      bookAnyway: false,
    });
  });
  it('another warning is not the stand-by one', async () => {
    const a = answering({ status: 200, data: { warnings: ['something_else'] } });
    await expect(sendLock('r1', { slotId: 's1' }, undefined, a.post)).resolves.toEqual({
      ok: true,
      standbyOfferLive: false,
    });
  });
  it('says when a live stand-by offer covers the time (T2.3 contract warning)', async () => {
    const a = answering({ status: 200, data: { warnings: ['standby_offer_live'] } });
    await expect(sendLock('r1', { slotId: 's1' }, undefined, a.post)).resolves.toEqual({
      ok: true,
      standbyOfferLive: true,
    });
  });
  it('a 409 reads in the server’s words; anything else is the generic line', async () => {
    const refused = answering({ status: 409, code: 'time_taken', message: 'That time just went.' });
    await expect(sendLock('r1', { slotId: 's1' }, undefined, refused.post)).resolves.toEqual({
      ok: false,
      code: 'time_taken',
      message: 'That time just went.',
    });
    for (const a of [
      { status: 409 },
      { status: 404, code: 'request_not_found', message: 'Not found.' },
      { status: 0 },
      { status: 500 },
    ]) {
      const r = await sendLock('r1', { slotId: 's1' }, undefined, answering(a).post);
      expect(r).toEqual({ ok: false, code: a.code ?? null, message: ERRORS.generic });
    }
  });
});
