// The .ics organiser is fixed by a booking's first E4c (ics-email.ts): a mailer switch between the REQUEST and its
// CANCEL must not change the organiser of the same UID, or clients may ignore the CANCEL.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mailer = vi.hoisted(() => ({ mode: 'resend' as 'resend' | 'gmail_api' }));
vi.mock('@/lib/adapters/mailer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/adapters/mailer')>()),
  currentMailerMode: async () => mailer.mode,
}));
vi.mock('@/features/calendar/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/calendar/connection')>()),
  loadConnection: async () => ({ account_email: 'connected@example.com' }),
}));

import { emailAttachments } from '@/features/calendar/ics-attachment';
import { queueIcsEmail } from '@/features/calendar/ics-email';
import { createRequestTx } from '@/features/requests/create';
import { RequestBody } from '@/features/requests/schema';
import { pool, q, withTx } from '@/lib/db';
import { removeRequests } from '../fixtures/requests-db';

const made: string[] = [];
let inviteId = '';
beforeAll(async () => {
  // leftovers of an earlier run on these hours
  await q(
    `update request set status = 'cancelled', cancelled_at = now()
      where status in ('locked', 'done') and locked_starts_at = any($1::timestamptz[])`,
    [STARTS],
  );
  inviteId = (
    await q<{ id: string }>(`select id from invite where kind = 'general' order by created_at limit 1`)
  )[0]!.id;
});
afterAll(async () => {
  mailer.mode = 'resend';
  await removeRequests(made);
  await pool().end();
});

/** Each case locks its own early-morning hour (no other file books these), so the no-overlap rule never bites. */
const STARTS = ['2027-06-29T10:00:00Z', '2027-06-29T12:00:00Z', '2027-06-29T14:00:00Z'];

/** A booking locked on a time (the row shape a lock leaves; no calendar involved). */
async function lockedBooking(startsAt: string): Promise<string> {
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name: 'Ola Guest',
    email: `ola+${randomUUID().slice(0, 8)}@example.com`,
    crew: 2,
    slotIds: [],
  });
  const { requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId,
      isTest: true,
      spam: false,
      mode: 'slots',
      status: 'requested',
      countsToward: 'weekly_cap',
      bigCrew: false,
      dishName: 'The Long Lunch',
    }),
  );
  made.push(requestId);
  await q(
    `update request set status = 'locked', locked_starts_at = $2::timestamptz,
                        locked_ends_at = $2::timestamptz + interval '1 hour'
      where id = $1`,
    [requestId, startsAt],
  );
  return requestId;
}
const e4c = (id: string) =>
  q<{ vars: Record<string, string | number>; to_email: string; created_at: Date }>(
    `select vars, to_email, created_at from email_log where request_id = $1 and template = 'E4c' order by created_at, id`,
    [id],
  );
async function organizerLine(row: {
  vars: Record<string, string | number>;
  to_email: string;
  created_at: Date;
}) {
  const [a] = (await emailAttachments('E4c', row.vars, row.to_email, row.created_at))!;
  return /ORGANIZER[^\r\n]*/.exec(Buffer.from(a!.content, 'base64').toString('utf8'))![0];
}

describe('the .ics organiser stays the same for a booking (REQUEST, then CANCEL after a mailer switch)', () => {
  it('the first E4c stores it; the CANCEL queued after the switch reuses it, so both files agree', async () => {
    mailer.mode = 'resend';
    const id = await lockedBooking(STARTS[0]!);
    await withTx((c) => queueIcsEmail(c, id, 'REQUEST'));
    mailer.mode = 'gmail_api'; // the AD-5 switch: worked out now, the organiser would be the connected account
    await withTx((c) => queueIcsEmail(c, id, 'CANCEL'));
    const rows = await e4c(id);
    expect(rows.map((r) => [r.vars.method, r.vars.sequence])).toEqual([
      ['REQUEST', 0],
      ['CANCEL', 1],
    ]);
    const first = rows[0]!.vars.organizerEmail;
    expect(typeof first).toBe('string');
    expect(first).not.toBe('connected@example.com');
    expect(rows[1]!.vars.organizerEmail).toBe(first);
    const [req, cancel] = [await organizerLine(rows[0]!), await organizerLine(rows[1]!)];
    expect(cancel).toBe(req);
    expect(req).toContain(`mailto:${first}`);
  });

  it('the other way round: a series started under Gmail keeps the connected account after a switch back', async () => {
    mailer.mode = 'gmail_api';
    const id = await lockedBooking(STARTS[1]!);
    await withTx((c) => queueIcsEmail(c, id, 'REQUEST'));
    mailer.mode = 'resend';
    await withTx((c) => queueIcsEmail(c, id, 'REQUEST')); // a moved time: an update of the same UID
    await withTx((c) => queueIcsEmail(c, id, 'CANCEL'));
    const rows = await e4c(id);
    expect(rows.map((r) => r.vars.organizerEmail)).toEqual([
      'connected@example.com',
      'connected@example.com',
      'connected@example.com',
    ]);
    const lines = await Promise.all(rows.map(organizerLine));
    expect(new Set(lines).size).toBe(1);
  });

  it('a series whose first E4c predates this keeps the send-time rule (nothing stored, nothing guessed)', async () => {
    mailer.mode = 'resend';
    const id = await lockedBooking(STARTS[2]!);
    await withTx((c) => queueIcsEmail(c, id, 'REQUEST'));
    await q(
      `update email_log set vars = vars - 'organizerEmail' where request_id = $1 and template = 'E4c'`,
      [id],
    );
    await withTx((c) => queueIcsEmail(c, id, 'CANCEL'));
    const rows = await e4c(id);
    expect(rows.map((r) => r.vars.organizerEmail ?? null)).toEqual([null, null]);
  });
});
