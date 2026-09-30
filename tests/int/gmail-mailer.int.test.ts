// T3.17.02 (TSD T3.17 AC3): a replayed send through GmailApiMailer doesn't send twice. Gmail has no
// idempotency key, so the email_log claim is the guard. Gmail itself is a scripted fetch: nothing leaves.
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { q, pool } from '@/lib/db';
import { deliverEmail, queueEmail, retryDueEmails } from '@/features/email/send';
import type { Adapters } from '@/lib/adapters/types';

const gmailFetch = vi.hoisted(() => ({ fn: null as unknown as import('vitest').Mock<typeof fetch> }));
vi.mock('@/lib/adapters', async () => {
  const { createGmailApiMailer: make } = await import('@/lib/adapters/gmail/mailer');
  const mailer = make({ getAccessToken: async () => 'ya29.test', fetch: (...a) => gmailFetch.fn(...a) });
  return { adapters: () => ({ mailer }) as unknown as Adapters };
});

async function row() {
  const r = await queueEmail(pool(), {
    template: 'E1',
    to: 'dave@example.com',
    requestId: null,
    eventKey: randomUUID(),
    vars: { dish: 'The Long Lunch' },
  });
  if (typeof r === 'string') throw new Error(r);
  return r.queued;
}

beforeEach(async () => {
  gmailFetch.fn = vi.fn(
    async () => new Response(JSON.stringify({ id: `g${randomUUID()}` }), { status: 200 }),
  );
  await q('delete from email_queue');
  await q('delete from email_log');
  await q('delete from email_budget');
});

describe('GmailApiMailer through the send path', () => {
  it('AC3: a replayed and a concurrent delivery of one email send once', async () => {
    const id = await row();
    const results = await Promise.all([
      deliverEmail(id, { inline: true }),
      deliverEmail(id, { inline: true }),
      deliverEmail(id, { inline: true }),
    ]);
    expect(results.sort()).toEqual(['sent', 'skipped', 'skipped']);
    expect(await deliverEmail(id, { inline: true })).toBe('skipped'); // a replay later
    expect(await retryDueEmails(new Date(Date.now() + 3_600_000), Date.now() + 5000)).toBe(0);
    expect(gmailFetch.fn).toHaveBeenCalledTimes(1);
    const [r] = await q<{ resend_id: string; status: string }>(
      'select resend_id, status::text from email_log',
    );
    expect(r!.status).toBe('sent');
    expect(r!.resend_id).toMatch(/^gmail:g/);
  });

  it('a Gmail error is one failed attempt; the tick retries it once at +5 min, not before', async () => {
    gmailFetch.fn.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const id = await row();
    expect(await deliverEmail(id, { inline: true })).toBe('failed');
    expect(await retryDueEmails(new Date(), Date.now() + 5000)).toBe(0);
    expect(await retryDueEmails(new Date(Date.now() + 6 * 60_000), Date.now() + 5000)).toBe(1);
    expect(gmailFetch.fn).toHaveBeenCalledTimes(2);
  });
});
