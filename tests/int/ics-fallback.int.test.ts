// T3.4.04-.06 (AD-6 fallback, TSD T3.4 AC4) + pr39 F4/F8 against the test DB: after the last failed try the guest
// gets exactly ONE .ics (E4c REQUEST), never Google's invite; the tick keeps retrying an attendee-less event until
// Google recovers; a move or a cancel of an 'ics_sent' booking sends a REQUEST/CANCEL with SEQUENCE bumped in the
// same transaction. Each test uses its own day; afterAll removes every request made here with its E4c and outbox
// rows, so a re-run on one DB never sweeps them (HYG/F4).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { pool, q, withTx } from '@/lib/db';
import { createRequestTx } from '@/features/requests/create';
import { RequestBody } from '@/features/requests/schema';
import { lockRequest } from '@/features/requests/lock';
import { cancelByGuest } from '@/features/requests/guest-cancel';
import { rerequestTx } from '@/features/requests/rerequest';
import { runAfterCommit } from '@/features/requests/side-effects';
import { processOutbox, retryDueOutbox } from '@/features/calendar/outbox';
import { icsDate } from '@/features/calendar/ics';
import { deliverEmail, MAX_ATTEMPTS } from '@/features/email/send';
import { sendQueuedEmails } from '@/features/email/queue';
import { failedEmails, resendFailedEmail } from '@/features/email/status';
import { runTick } from '@/features/jobs';
import { mockCalendar } from '@/lib/adapters/mock/calendar';
import { mockMailer } from '@/lib/adapters/mock/mailer';
import type { OutgoingEmail } from '@/lib/adapters/types';
import { vancouverInstant } from '@/lib/time';
import { POST as resendRoute } from '@/app/api/admin/email/[id]/resend/route';
import { removeRequests } from '../fixtures/requests-db';

// The mock mailer's own send, taken before any test spies on it (a spy re-created on a spy is the same spy).
const realSend = mockMailer.send.bind(mockMailer);
// Jon's session, for the Resend route (the same mock as email-guard.int).
vi.mock('@/features/admin/supabase', () => ({
  sendOtpEmail: vi.fn(),
  currentAuthEmail: vi.fn(async () => 'jon@example.com'),
}));

vi.mock('@/features/availability/canLock', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/features/availability/canLock')>();
  return { ...m, canLock: () => ({ ok: true, warnings: [] }) };
});

const made: string[] = [];
let inviteId = '';
beforeAll(async () => {
  inviteId = (await q<{ id: string }>(`select id from invite where kind = 'general'`))[0]!.id;
});
afterAll(async () => {
  await removeRequests(made); // with their E4c + outbox rows: a re-run on one DB sweeps none of them
  await pool().end();
});

const LATER = new Date('2027-01-01T00:00:00Z'); // every retry is due, still before the season
const at = (h: number) => new Date(LATER.getTime() + h * 3_600_000);
const googleDown = () => vi.spyOn(mockCalendar, 'insert').mockRejectedValue(new Error('google down'));
const googleUp = (spy: ReturnType<typeof googleDown>) =>
  spy.mockImplementation(async () => ({ eventId: `mock-${randomUUID()}` }));

async function newRequest(): Promise<{ id: string; email: string }> {
  const email = `ics+${randomUUID().slice(0, 8)}@example.com`;
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name: 'Dave Guest',
    email,
    crew: 3,
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
      dishName: 'The Long Lunch',
    }),
  );
  made.push(requestId);
  return { id: requestId, email };
}
const range = (date: string, from: string, to: string) => ({
  startsAt: vancouverInstant(date, from),
  endsAt: vancouverInstant(date, to),
  countsToward: 'none' as const,
  where: null,
});
const req = async (id: string) =>
  (
    await q<{ calendar_state: string; google_event_id: string | null; ics_sequence: number; status: string }>(
      `select calendar_state::text as calendar_state, google_event_id, ics_sequence, status::text as status
         from request where id = $1`,
      [id],
    )
  )[0]!;
const outboxRows = (id: string) =>
  q<{ id: string; kind: string; attempts: number; done_at: Date | null; next_attempt_at: Date }>(
    `select id, kind::text as kind, attempts, done_at, next_attempt_at from outbox where request_id = $1
      order by created_at, id`,
    [id],
  );
const e4c = (id: string) =>
  q<{ id: string; status: string; event_key: string; vars: Record<string, unknown> }>(
    `select id, status, event_key, vars from email_log where request_id = $1 and template = 'E4c'
      order by created_at, id`,
    [id],
  );
/** The .ics files that actually went out to this address, decoded, oldest first. */
function sentIcs(send: { mock: { calls: [OutgoingEmail][] } }, to: string): string[] {
  return send.mock.calls
    .map(([e]) => e)
    .filter((e) => e.template === 'E4c' && e.to === to)
    .map((e) => Buffer.from(e.attachments![0]!.content, 'base64').toString('utf8'));
}
/** This request's E4c rows in SEQUENCE order. */
const e4cRows = (id: string) =>
  q<{ status: string; attempts: number; seq: string }>(
    `select status::text, attempts, vars->>'sequence' as seq from email_log
      where request_id = $1 and template = 'E4c' order by (vars->>'sequence')::int`,
    [id],
  );
const line = (ics: string, key: string) => new RegExp(`^${key}:(.*)$`, 'm').exec(ics)?.[1]?.trim();

/** Tries 2-4 of the open row (try 1 ran inline at the lock), at hours h, h+1 and h+2. */
async function exhaust(id: string, h: number): Promise<void> {
  const open = (await outboxRows(id)).filter((o) => !o.done_at).at(-1)!;
  for (let i = 0; i < 3; i++) await processOutbox(open.id, { inline: false, now: at(h + i) });
}

describe('the .ics fallback (T3.4.04-.06, AD-6)', () => {
  it('AC4: after the last failed try, exactly one .ics and no Google invite; then an attendee-less event once Google recovers', async () => {
    const insert = googleDown();
    const send = vi.spyOn(mockMailer, 'send');
    const { id, email } = await newRequest();
    expect(
      await lockRequest({ requestId: id, target: range('2027-06-07', '12:00', '14:00'), mode: 'lock' }),
    ).toMatchObject({ ok: true });
    await exhaust(id, 0);
    expect(insert).toHaveBeenCalledTimes(4); // every try with the guest on it failed: Google sent no invite
    expect(insert.mock.calls.every(([e]) => e.attendees.includes(email))).toBe(true);
    expect(await req(id)).toMatchObject({
      calendar_state: 'ics_sent',
      google_event_id: null,
      ics_sequence: 0,
    });
    const [mail] = await e4c(id);
    expect(mail).toMatchObject({ status: 'sent', event_key: 'ics:0' });
    expect(JSON.stringify(mail!.vars)).not.toMatch(/token|manage\?t=/); // a snapshot of the booking, no link
    const [ics] = sentIcs(send, email);
    expect(line(ics!, 'METHOD')).toBe('REQUEST');
    expect(line(ics!, 'SEQUENCE')).toBe('0');
    expect(line(ics!, 'UID')).toBe(`${id}@timewithjon.com`);
    expect(line(ics!, 'DTSTART')).toBe('20270607T190000Z');
    // The last row is closed; a fresh one keeps trying on the cadence, with its own tries.
    const [first, fresh] = await outboxRows(id);
    expect(first).toMatchObject({ attempts: 4 });
    expect(first!.done_at).not.toBeNull();
    expect(fresh).toMatchObject({ kind: 'calendar_create', attempts: 0, done_at: null });
    expect(fresh!.next_attempt_at).toEqual(new Date(at(2).getTime() + 5 * 60_000));

    // Google still down for the whole fresh row: no second .ics, and yet another row.
    for (let i = 0; i < 4; i++) await processOutbox(fresh!.id, { inline: false, now: at(10 + i) });
    expect(await e4c(id)).toHaveLength(1);
    expect(sentIcs(send, email)).toHaveLength(1);
    const rows = await outboxRows(id);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ kind: 'calendar_create', attempts: 0, done_at: null });

    // Google recovers: the event is made with nobody but Jon on it, and the booking stays 'ics_sent'.
    googleUp(insert);
    expect(await processOutbox(rows[2]!.id, { inline: false, now: at(20) })).toBe('synced');
    expect(insert.mock.calls.at(-1)![0].attendees).toEqual([]);
    const after = await req(id);
    expect(after.calendar_state).toBe('ics_sent');
    expect(after.google_event_id).toMatch(/^mock-/);
    expect((await outboxRows(id)).every((o) => o.done_at)).toBe(true);
    insert.mockRestore();
    send.mockRestore();
  });

  it('F8: after the .ics fallback, a guest cancel sends a CANCEL with SEQUENCE+1 (Change time, the move, removed 2026-09-29)', async () => {
    const insert = googleDown();
    const send = vi.spyOn(mockMailer, 'send');
    const { id, email } = await newRequest();
    await lockRequest({ requestId: id, target: range('2027-06-08', '12:00', '14:00'), mode: 'lock' });
    await exhaust(id, 30);
    googleUp(insert);
    expect(await req(id)).toMatchObject({ calendar_state: 'ics_sent', ics_sequence: 0 });

    expect(await cancelByGuest(id, at(41))).toMatchObject({ ok: true });
    const cancel = sentIcs(send, email)[1]!;
    expect([line(cancel, 'METHOD'), line(cancel, 'SEQUENCE'), line(cancel, 'STATUS')]).toEqual([
      'CANCEL',
      '1',
      'CANCELLED',
    ]);
    expect(line(cancel, 'DTSTART')).toBe('20270608T190000Z'); // the time it had, read before anything cleared it
    const texts = send.mock.calls
      .filter(([e]) => e.template === 'E4c' && e.to === email)
      .map(([e]) => e.text);
    expect(texts[0]).toMatch(/^Here’s the calendar invite for The Long Lunch, /);
    expect(texts[1]).toMatch(/^The Long Lunch, .*, is off\. Open the attached update/);
    expect((await e4c(id)).map((m) => m.event_key)).toEqual(['ics:0', 'ics:1']);
    // The delete waits behind the still-open retry row; the next tick closes that one and then deletes.
    for (const o of (await outboxRows(id)).filter((r) => !r.done_at))
      await processOutbox(o.id, { inline: false, now: at(42) });
    expect(await req(id)).toMatchObject({ status: 'cancelled', calendar_state: 'none', ics_sequence: 1 });
    insert.mockRestore();
    send.mockRestore();
  });
  it('F8: a guest who asks for another time gets the CANCEL; a re-lock that falls back again goes on counting up', async () => {
    const insert = googleDown();
    const send = vi.spyOn(mockMailer, 'send');
    const { id, email } = await newRequest();
    await lockRequest({ requestId: id, target: range('2027-06-09', '12:00', '14:00'), mode: 'lock' });
    await exhaust(id, 50);
    const { after } = await withTx((c) =>
      rerequestTx(c, {
        requestId: id,
        checked: {
          mode: 'slots',
          countsToward: 'weekly_cap',
          slotIds: [],
          datePrefs: null,
          overnight: false,
          overnightNight: null,
          pitchIdea: null,
        },
        now: at(60),
        clientKey: randomUUID(),
        payloadHash: '0'.repeat(64),
      }),
    );
    await runAfterCommit(after, 'test');
    const cancel = sentIcs(send, email)[1]!;
    expect([line(cancel, 'METHOD'), line(cancel, 'SEQUENCE'), line(cancel, 'DTSTART')]).toEqual([
      'CANCEL',
      '1',
      '20270609T190000Z',
    ]);
    // The delete waits behind the still-open retry row; the next tick closes that one (not locked) and then deletes.
    for (const o of (await outboxRows(id)).filter((r) => !r.done_at))
      await processOutbox(o.id, { inline: false, now: at(61) });
    expect(await req(id)).toMatchObject({ status: 'requested', calendar_state: 'none' });
    expect((await outboxRows(id)).every((o) => o.done_at)).toBe(true);

    // Locked again and Google fails again: the new REQUEST must outrank the CANCEL, or the calendar ignores it.
    await lockRequest({ requestId: id, target: range('2027-06-09', '15:00', '16:00'), mode: 'lock' });
    await exhaust(id, 70);
    const again = sentIcs(send, email)[2]!;
    expect([line(again, 'METHOD'), line(again, 'SEQUENCE')]).toEqual(['REQUEST', '2']);
    expect((await e4c(id)).map((m) => m.event_key)).toEqual(['ics:0', 'ics:1', 'ics:2']);
    insert.mockRestore();
    send.mockRestore();
  });

  it('a booking already over when the tries run out gets no .ics: it is marked failed', async () => {
    const insert = googleDown();
    const { id } = await newRequest();
    await lockRequest({ requestId: id, target: range('2027-06-14', '12:00', '14:00'), mode: 'lock' });
    const [row] = await outboxRows(id);
    for (let i = 0; i < 3; i++)
      await processOutbox(row!.id, { inline: false, now: new Date(Date.UTC(2027, 6, 1, i)) });
    expect(await req(id)).toMatchObject({ calendar_state: 'failed', ics_sequence: 0 });
    expect(await e4c(id)).toEqual([]);
    expect(await outboxRows(id)).toHaveLength(1);
    insert.mockRestore();
  });

  it('L1 + AD-6: a last try that died mid-call (no catch ran) gets the .ics from the tick', async () => {
    const insert = googleDown();
    const { id } = await newRequest();
    await lockRequest({ requestId: id, target: range('2027-06-22', '12:00', '14:00'), mode: 'lock' });
    await q(`update outbox set attempts = 4, next_attempt_at = $2 where request_id = $1`, [id, at(80)]);
    await runTick(at(81));
    expect(await req(id)).toMatchObject({ calendar_state: 'ics_sent' });
    expect(await e4c(id)).toMatchObject([{ status: 'sent', event_key: 'ics:0' }]);
    await runTick(at(81)); // runs once: the stranded row is closed
    expect(await e4c(id)).toHaveLength(1);
    expect((await outboxRows(id)).filter((o) => !o.done_at)).toHaveLength(1);
    insert.mockRestore();
  });

  it('an ics_sent booking stops retrying once it is over; a stranded last try of an ics_sent row is closed too', async () => {
    const insert = googleDown();
    const { id } = await newRequest();
    await lockRequest({ requestId: id, target: range('2027-06-14', '17:00', '18:00'), mode: 'lock' });
    await exhaust(id, 110);
    const fresh = (await outboxRows(id)).at(-1)!;
    // A crash during the fresh row's last try, still ahead of the booking: the tick closes it and makes the next.
    await q(`update outbox set attempts = 4, next_attempt_at = $2 where id = $1`, [fresh.id, at(111)]);
    await runTick(at(112));
    let rows = await outboxRows(id);
    expect(rows).toHaveLength(3);
    expect(rows[1]!.done_at).not.toBeNull();
    // The next row runs out after the booking has ended: closed, and no new row; still one .ics, still 'ics_sent'.
    for (let i = 0; i < 4; i++)
      await processOutbox(rows[2]!.id, { inline: false, now: new Date(Date.UTC(2027, 6, 2, i)) });
    rows = await outboxRows(id);
    expect(rows).toHaveLength(3);
    expect(rows.every((o) => o.done_at)).toBe(true);
    expect(await req(id)).toMatchObject({ calendar_state: 'ics_sent' });
    expect(await e4c(id)).toHaveLength(1);
    insert.mockRestore();
  });

  it('pr54 F1: two overlapping sweeps of one stranded row send one .ics and leave one fresh retry row', async () => {
    const insert = googleDown();
    const { id } = await newRequest();
    await lockRequest({ requestId: id, target: range('2027-06-26', '12:00', '14:00'), mode: 'lock' });
    await q(`update outbox set attempts = 4, next_attempt_at = $2 where request_id = $1`, [id, at(80)]);
    // Hold the booking so both sweeps reach the out-of-tries step for the same row before either finishes.
    const holder = await pool().connect();
    await holder.query('begin');
    await holder.query('select 1 from request where id = $1 for update', [id]);
    const deadline = Date.now() + 30_000;
    const sweeps = Promise.all([retryDueOutbox(at(81), deadline), retryDueOutbox(at(81), deadline)]);
    await new Promise((r) => setTimeout(r, 300));
    await holder.query('commit');
    holder.release();
    await sweeps;
    expect(await e4c(id)).toHaveLength(1);
    expect((await outboxRows(id)).filter((o) => !o.done_at)).toHaveLength(1);
    insert.mockRestore();
  });

  it('pr54 F2: a patch that runs out of tries when the event exists (Google invited the guest) is failed, never an .ics', async () => {
    const { id } = await newRequest();
    await lockRequest({ requestId: id, target: range('2027-06-20', '07:00', '08:00'), mode: 'lock' });
    expect((await req(id)).google_event_id).not.toBeNull();
    const patch = vi.spyOn(mockCalendar, 'patch').mockRejectedValue(new Error('google down'));
    // A time change on a Google-invited booking (a patch row; Change time itself was removed 2026-09-29).
    const moved = range('2027-06-20', '09:00', '10:00');
    await q(`update request set locked_starts_at = $2, locked_ends_at = $3 where id = $1`, [
      id,
      moved.startsAt,
      moved.endsAt,
    ]);
    const [row] = await q<{ id: string }>(
      `insert into outbox (kind, request_id) values ('calendar_patch', $1) returning id`,
      [id],
    );
    await processOutbox(row!.id, { inline: true }); // the after-commit try, then the three tick retries
    await exhaust(id, 120);
    expect(patch).toHaveBeenCalledTimes(4);
    expect(await req(id)).toMatchObject({ calendar_state: 'failed', ics_sequence: 0 });
    expect(await e4c(id)).toEqual([]);
    patch.mockRestore();
  });

  it('an E4c whose vars cannot make a valid .ics is terminal: never sent, never retried', async () => {
    const send = vi.spyOn(mockMailer, 'send');
    const { id, email } = await newRequest();
    const [row] = await q<{ id: string }>(
      `insert into email_log (template, to_email, request_id, event_key, status, vars)
       values ('E4c', $1, $2, 'ics:9', 'pending', $3) returning id`,
      [email, id, JSON.stringify({ dish: 'The Long Lunch', lead: 'x', method: 'PUBLISH' })],
    );
    expect(await deliverEmail(row!.id, { inline: true })).toBe('failed');
    const [log] = await q<{ attempts: number; last_error: string }>(
      `select attempts, last_error from email_log where id = $1`,
      [row!.id],
    );
    expect(log).toEqual({ attempts: 4, last_error: 'IcsRenderError' });
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it('a delete that runs out of tries on an ics_sent booking is failed for admin (the event is still there)', async () => {
    const insert = googleDown();
    const remove = vi.spyOn(mockCalendar, 'remove').mockRejectedValue(new Error('google down'));
    const { id } = await newRequest();
    await lockRequest({ requestId: id, target: range('2027-06-22', '17:00', '18:00'), mode: 'lock' });
    await exhaust(id, 120);
    googleUp(insert);
    await processOutbox((await outboxRows(id)).at(-1)!.id, { inline: false, now: at(125) }); // the event is made
    expect(await cancelByGuest(id, at(126))).toMatchObject({ ok: true });
    const del = (await outboxRows(id)).at(-1)!;
    expect(del.kind).toBe('calendar_delete');
    for (let i = 0; i < 3; i++) await processOutbox(del.id, { inline: false, now: at(127 + i) });
    expect(await req(id)).toMatchObject({ calendar_state: 'failed' });
    expect((await outboxRows(id)).at(-1)).toMatchObject({
      kind: 'calendar_delete',
      attempts: 4,
      done_at: null,
    });
    insert.mockRestore();
    remove.mockRestore();
  });

  it('pr39 F4: a delete waits for an older create still in flight on its last try (no event left behind)', async () => {
    const insert = googleDown();
    const { id } = await newRequest();
    await lockRequest({ requestId: id, target: range('2027-06-23', '12:00', '14:00'), mode: 'lock' });
    // The create's 4th try is claimed and calling Google (lease until hour 91) when the guest cancels.
    await q(`update outbox set attempts = 4, next_attempt_at = $2 where request_id = $1`, [id, at(91)]);
    const [del] = await q<{ id: string }>(
      `insert into outbox (kind, request_id) values ('calendar_delete', $1) returning id`,
      [id],
    );
    expect(await processOutbox(del!.id, { inline: true, now: at(90) })).toBe('skipped');
    expect(await processOutbox(del!.id, { inline: false, now: at(92) })).toBe('synced'); // the lease ran out
    insert.mockRestore();
  });

  it('pr54 F6: a CANCEL waits for its older REQUEST still being retried (no attempt burned); an abandoned one no longer blocks', async () => {
    const insert = googleDown();
    const { id, email } = await newRequest();
    await lockRequest({ requestId: id, target: range('2027-06-10', '12:00', '14:00'), mode: 'lock' });
    const send = vi.spyOn(mockMailer, 'send').mockRejectedValueOnce(new Error('network')); // the REQUEST's first send
    await exhaust(id, 300);
    const methods = () => sentIcs(send, email).map((f) => line(f, 'METHOD'));
    const rows = async () =>
      q<{ status: string; attempts: number; seq: string }>(
        `select status::text, attempts, vars->>'sequence' as seq from email_log
          where request_id = $1 and template = 'E4c' order by (vars->>'sequence')::int`,
        [id],
      );
    expect(await rows()).toEqual([{ status: 'failed', attempts: 1, seq: '0' }]);

    expect(await cancelByGuest(id, at(310))).toMatchObject({ ok: true });
    const [request, cancel] = await e4c(id);
    expect(await rows()).toEqual([
      { status: 'failed', attempts: 1, seq: '0' },
      { status: 'pending', attempts: 0, seq: '1' }, // not sent before the REQUEST, and no attempt used
    ]);
    expect(await deliverEmail(cancel!.id, { inline: false, now: at(400) })).toBe('skipped');
    expect((await rows())[1]).toEqual({ status: 'pending', attempts: 0, seq: '1' });
    const [next] = await q<{ t: Date }>(`select next_attempt_at as t from email_log where id = $1`, [
      cancel!.id,
    ]);
    expect(next!.t.getTime()).toBe(at(400).getTime() + 60_000); // this tick's retry batches won't pick it again
    expect(methods()).toEqual(['REQUEST']); // only the REQUEST's failed try so far

    expect(await deliverEmail(request!.id, { inline: false, now: at(400) })).toBe('sent');
    expect(await deliverEmail(cancel!.id, { inline: false, now: at(401) })).toBe('sent');
    expect(methods()).toEqual(['REQUEST', 'REQUEST', 'CANCEL']); // the guest gets them in order

    // An older E4c that is out of tries doesn't hold a newer one back forever (once its last lease is over).
    await q(`update email_log set status = 'failed', attempts = 4, next_attempt_at = $2 where id = $1`, [
      request!.id,
      at(401),
    ]);
    await q(`update email_log set status = 'pending', attempts = 0 where id = $1`, [cancel!.id]);
    expect(await deliverEmail(cancel!.id, { inline: false, now: at(402) })).toBe('sent');
    insert.mockRestore();
    send.mockRestore();
  });

  it('pr58 F2: a CANCEL never overtakes its REQUEST on its last try; once that try fails for good it goes after the lease', async () => {
    const insert = googleDown();
    const { id, email } = await newRequest();
    await lockRequest({ requestId: id, target: range('2027-06-11', '12:00', '14:00'), mode: 'lock' });
    const send = vi.spyOn(mockMailer, 'send').mockRejectedValueOnce(new Error('network')); // the REQUEST's first send
    await exhaust(id, 500);
    expect(await cancelByGuest(id, at(510))).toMatchObject({ ok: true });
    const [request, cancel] = await e4c(id);
    await q(`update email_log set attempts = $2 where id = $1`, [request!.id, MAX_ATTEMPTS - 1]); // next try is the last
    const t = at(600);
    let during: string | undefined;
    send.mockImplementationOnce(async () => {
      // the guest (or an overlapping tick) reaches the CANCEL while the REQUEST's last try is at the mailer
      during = await deliverEmail(cancel!.id, { inline: true, now: t });
      throw new Error('network');
    });
    expect(await deliverEmail(request!.id, { inline: false, now: t })).toBe('failed');
    expect(during).toBe('skipped');
    expect(await e4cRows(id)).toEqual([
      { status: 'failed', attempts: MAX_ATTEMPTS, seq: '0' },
      { status: 'pending', attempts: 0, seq: '1' },
    ]);
    const plus = (min: number) => new Date(t.getTime() + min * 60_000);
    const nextOf = async () =>
      (await q<{ t: Date }>(`select next_attempt_at as t from email_log where id = $1`, [cancel!.id]))[0]!.t;
    await q(`update email_log set next_attempt_at = $2 where id = $1`, [cancel!.id, plus(25)]); // a backoff
    expect(await deliverEmail(cancel!.id, { inline: true, now: plus(10) })).toBe('skipped'); // the lease is still on
    expect((await nextOf()).getTime()).toBe(plus(25).getTime()); // pr58 F6: the wait never shortens a backoff
    await q(`update email_log set next_attempt_at = $2 where id = $1`, [cancel!.id, plus(10)]);
    expect(await deliverEmail(cancel!.id, { inline: false, now: plus(10) })).toBe('skipped');
    expect(await deliverEmail(cancel!.id, { inline: false, now: plus(31) })).toBe('sent'); // abandoned: it goes
    expect(sentIcs(send, email).map((f) => line(f, 'METHOD'))).toEqual(['REQUEST', 'REQUEST', 'CANCEL']);
    insert.mockRestore();
    send.mockRestore();
  });

  it('pr58 F1: once a CANCEL went out, its abandoned REQUEST is never sent: Resend refuses it, a racing claim ends it', async () => {
    const insert = googleDown();
    const { id, email } = await newRequest();
    await lockRequest({ requestId: id, target: range('2027-06-12', '12:00', '14:00'), mode: 'lock' });
    const send = vi.spyOn(mockMailer, 'send').mockRejectedValueOnce(new Error('network')); // the REQUEST's first send
    await exhaust(id, 650);
    const [request] = await e4c(id);
    // abandoned: out of tries, its last lease over (on the DB clock, which the inline CANCEL below uses)
    await q(`update email_log set attempts = $2, next_attempt_at = now() - interval '1 hour' where id = $1`, [
      request!.id,
      MAX_ATTEMPTS,
    ]);
    expect(await cancelByGuest(id, at(660))).toMatchObject({ ok: true });
    const methods = () => sentIcs(send, email).map((f) => line(f, 'METHOD'));
    expect(methods()).toEqual(['REQUEST', 'CANCEL']); // the REQUEST's failed try, then the CANCEL
    expect(await e4cRows(id)).toEqual([
      { status: 'failed', attempts: MAX_ATTEMPTS, seq: '0' },
      { status: 'sent', attempts: 1, seq: '1' },
    ]);

    // Jon's Resend on the failed REQUEST: refused by name, hidden in the list, the row untouched
    expect((await failedEmails(500)).find((f) => f.id === request!.id)?.resendable).toBe(false);
    expect(await resendFailedEmail(request!.id)).toBe('superseded');
    expect((await e4cRows(id))[0]).toEqual({ status: 'failed', attempts: MAX_ATTEMPTS, seq: '0' });

    // A Resend that reset it just before the CANCEL went out: the claim ends it for good instead of sending it
    await q(`update email_log set status = 'pending', attempts = 0, last_error = null where id = $1`, [
      request!.id,
    ]);
    expect(await deliverEmail(request!.id, { inline: true, priority: 1 })).toBe('failed');
    const [ended] = await q<{ status: string; attempts: number; last_error: string }>(
      `select status::text, attempts, last_error from email_log where id = $1`,
      [request!.id],
    );
    expect(ended).toEqual({ status: 'failed', attempts: MAX_ATTEMPTS, last_error: 'superseded' });
    expect(await resendFailedEmail(request!.id)).toBe('superseded');
    expect(methods()).toEqual(['REQUEST', 'CANCEL']); // nothing more reached the guest
    insert.mockRestore();
    send.mockRestore();
  });

  it("pr58 F3: the order is per booking: another booking's REQUEST still being retried never holds this one's CANCEL", async () => {
    const insert = googleDown();
    const a = await newRequest();
    const b = await newRequest();
    await lockRequest({ requestId: a.id, target: range('2027-06-13', '12:00', '14:00'), mode: 'lock' });
    const send = vi.spyOn(mockMailer, 'send').mockRejectedValueOnce(new Error('network')); // A's REQUEST
    await exhaust(a.id, 800);
    expect(await e4cRows(a.id)).toEqual([{ status: 'failed', attempts: 1, seq: '0' }]);
    await lockRequest({ requestId: b.id, target: range('2027-06-15', '12:00', '14:00'), mode: 'lock' });
    await exhaust(b.id, 810);
    expect(await cancelByGuest(b.id, at(820))).toMatchObject({ ok: true });
    expect(await e4cRows(b.id)).toEqual([
      { status: 'sent', attempts: 1, seq: '0' },
      { status: 'sent', attempts: 1, seq: '1' },
    ]);
    expect(sentIcs(send, b.email).map((f) => line(f, 'METHOD'))).toEqual(['REQUEST', 'CANCEL']);
    insert.mockRestore();
    send.mockRestore();
  });

  it('pr58 F4: a CANCEL waits for its REQUEST parked by the daily budget; the 00:05 drain sends the REQUEST, then the CANCEL goes', async () => {
    const today = `(now() at time zone 'utc')::date`;
    const [saved] = await q<{ sent_count: number; limit_hit_at: Date | null }>(
      `select sent_count, limit_hit_at from email_budget where utc_day = ${today}`,
    );
    const setBudget = (n: number, hit: Date | null = null) =>
      q(
        `insert into email_budget (utc_day, sent_count, limit_hit_at) values (${today}, $1, $2)
         on conflict (utc_day) do update set sent_count = $1, limit_hit_at = $2`,
        [n, hit],
      );
    const insert = googleDown();
    const send = vi.spyOn(mockMailer, 'send');
    try {
      const { id, email } = await newRequest();
      await lockRequest({ requestId: id, target: range('2027-06-16', '12:00', '14:00'), mode: 'lock' });
      await setBudget(95); // the P1 ceiling: the REQUEST parks for 00:05 UTC
      await exhaust(id, 700);
      expect(await e4cRows(id)).toEqual([{ status: 'queued', attempts: 0, seq: '0' }]);
      await setBudget(0);
      expect(await cancelByGuest(id, at(710))).toMatchObject({ ok: true });
      const [, cancel] = await e4c(id);
      expect((await e4cRows(id))[1]).toEqual({ status: 'pending', attempts: 0, seq: '1' }); // waits, no try used
      await sendQueuedEmails(at(760), Date.now() + 60_000, 500);
      expect((await e4cRows(id))[0]).toMatchObject({ status: 'sent', seq: '0' });
      expect(await deliverEmail(cancel!.id, { inline: false, now: at(761) })).toBe('sent');
      expect(sentIcs(send, email).map((f) => line(f, 'METHOD'))).toEqual(['REQUEST', 'CANCEL']);
    } finally {
      if (saved) await setBudget(saved.sent_count, saved.limit_hit_at);
      else await q(`delete from email_budget where utc_day = ${today}`);
      insert.mockRestore();
      send.mockRestore();
    }
  });

  /** A booking whose REQUEST is abandoned (out of tries, last lease over on the DB clock), then cancelled by the guest. */
  async function abandonedThenCancelled(
    date: string,
    h: number,
    onCancel: (requestMailId: string) => Promise<void>,
  ) {
    const insert = googleDown();
    const { id, email } = await newRequest();
    await lockRequest({ requestId: id, target: range(date, '12:00', '14:00'), mode: 'lock' });
    const send = vi.spyOn(mockMailer, 'send').mockRejectedValueOnce(new Error('network')); // the REQUEST's first send
    await exhaust(id, h);
    const [request] = await e4c(id);
    await q(`update email_log set attempts = $2, next_attempt_at = now() - interval '1 hour' where id = $1`, [
      request!.id,
      MAX_ATTEMPTS,
    ]);
    send.mockImplementation(async (e) => {
      if (
        e.template === 'E4c' &&
        line(Buffer.from(e.attachments![0]!.content, 'base64').toString(), 'METHOD') === 'CANCEL'
      )
        await onCancel(request!.id);
      return realSend(e);
    });
    expect(await cancelByGuest(id, at(h + 10))).toMatchObject({ ok: true });
    const [, cancel] = await e4c(id);
    const done = () => {
      insert.mockRestore();
      send.mockRestore();
    };
    return { id, email, request: request!, cancel: cancel!, send, done };
  }
  const resendPost = (id: string) =>
    resendRoute(
      new NextRequest(`http://localhost:3000/api/admin/email/${id}/resend`, {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
      }),
      { params: Promise.resolve({ id }) },
    );

  it('pr58-verify N1: a Resend of the REQUEST while its CANCEL is at the mailer is refused (superseded)', async () => {
    let during: string | undefined;
    const b = await abandonedThenCancelled('2027-06-17', 900, async (requestMailId) => {
      during ??= await resendFailedEmail(requestMailId); // the CANCEL is claimed, not yet 'sent'
    });
    expect(during).toBe('superseded');
    expect(await e4cRows(b.id)).toEqual([
      { status: 'failed', attempts: MAX_ATTEMPTS, seq: '0' },
      { status: 'sent', attempts: 1, seq: '1' },
    ]);
    expect(sentIcs(b.send, b.email).map((f) => line(f, 'METHOD'))).toEqual(['REQUEST', 'CANCEL']);
    b.done();
  });

  it('pr58-verify N2: with the CANCEL abandoned too, only the CANCEL can be resent; the REQUEST gets 409 superseded', async () => {
    const b = await abandonedThenCancelled('2027-06-18', 950, async () => {
      throw new Error('network'); // the CANCEL's send fails
    });
    await q(`update email_log set attempts = $2 where id = $1`, [b.cancel.id, MAX_ATTEMPTS]); // abandoned too
    expect(await e4cRows(b.id)).toEqual([
      { status: 'failed', attempts: MAX_ATTEMPTS, seq: '0' },
      { status: 'failed', attempts: MAX_ATTEMPTS, seq: '1' },
    ]);
    const listed = await failedEmails(500);
    expect(listed.find((f) => f.id === b.request.id)?.resendable).toBe(false);
    expect(listed.find((f) => f.id === b.cancel.id)?.resendable).toBe(true);
    expect(await resendFailedEmail(b.request.id)).toBe('superseded');
    const res = await resendPost(b.request.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: 'superseded' });
    b.send.mockImplementation(realSend);
    expect(await resendFailedEmail(b.cancel.id)).toBe('sent');
    expect(sentIcs(b.send, b.email).map((f) => line(f, 'METHOD'))).toEqual(['REQUEST', 'CANCEL', 'CANCEL']);
    b.done();
  });

  it('pr58-verify N3: a newer E4c that went out and then bounced, complained or was delayed still supersedes at the claim', async () => {
    const b = await abandonedThenCancelled('2027-06-19', 1000, async () => {});
    for (const status of ['sent', 'delayed', 'bounced', 'complained']) {
      await q(`update email_log set status = $2::email_status where id = $1`, [b.cancel.id, status]);
      await q(`update email_log set status = 'pending', attempts = 0, last_error = null where id = $1`, [
        b.request.id,
      ]); // e.g. reset by a Resend just before the CANCEL was queued
      expect(await deliverEmail(b.request.id, { inline: true, priority: 1 })).toBe('failed');
      const [row] = await q<{ last_error: string }>(`select last_error from email_log where id = $1`, [
        b.request.id,
      ]);
      expect([status, row!.last_error]).toEqual([status, 'superseded']);
    }
    expect(sentIcs(b.send, b.email).map((f) => line(f, 'METHOD'))).toEqual(['REQUEST', 'CANCEL']);
    b.done();
  });

  it('a failed E4c send is retried with the byte-identical .ics (same row, same file)', async () => {
    const insert = googleDown();
    const { id, email } = await newRequest();
    await lockRequest({ requestId: id, target: range('2027-06-06', '12:00', '14:00'), mode: 'lock' });
    const send = vi.spyOn(mockMailer, 'send').mockRejectedValueOnce(new Error('network')); // the E4c's first send
    await exhaust(id, 100);
    const [mail] = await e4c(id);
    expect(mail!.status).toBe('failed');
    vi.setSystemTime(Date.now() + 60_000); // pr54 F3: the retry is rendered a minute later, still the same file
    try {
      expect(await deliverEmail(mail!.id, { inline: false, now: at(200) })).toBe('sent');
    } finally {
      vi.useRealTimers();
    }
    const files = send.mock.calls.filter(([e]) => e.template === 'E4c' && e.to === email).map(([e]) => e);
    expect(files).toHaveLength(2);
    const [stamp] = await q<{ created_at: Date }>(`select created_at from email_log where id = $1`, [
      mail!.id,
    ]);
    const first = Buffer.from(files[0]!.attachments![0]!.content, 'base64').toString('utf8');
    expect(line(first, 'DTSTAMP')).toBe(icsDate(stamp!.created_at)); // stamped with the row, not the send time
    expect(files[1]!.attachments).toEqual(files[0]!.attachments);
    expect(files[1]!.idempotencyKey).toBe(files[0]!.idempotencyKey);
    insert.mockRestore();
    send.mockRestore();
  });
});
