// T1.7 AC5–7 + T0.2 AC5 + T1.8 AC2 (SQL level) + the email send path (H4, M4) against the test DB.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, q, withTx } from '@/lib/db';
import { createRequest, createRequestTx, ReplayConflictError } from '@/features/requests/create';
import { RequestBody } from '@/features/requests/schema';
import { saveAfterSendStory } from '@/features/photos/after-send';
import { deliverRequestEmails, queueEmail, sendTemplate } from '@/features/email/send';
import { runTick } from '@/features/jobs';
import { mockMailer } from '@/lib/adapters/mock/mailer';
import { todayCount } from '../fixtures/event-count';

let inviteId = '';
let personalInviteId = '';
let slotIds: string[] = [];
beforeAll(async () => {
  inviteId = (await q<{ id: string }>(`select id from invite where kind = 'general'`))[0]!.id;
  personalInviteId = (await q<{ id: string }>(`select id from invite where name_slug = 'dave'`))[0]!.id;
  slotIds = (
    await q<{ id: string }>(`select id from slot where date = '2027-05-13' order by window_kind`)
  ).map((r) => r.id);
});
afterAll(async () => {
  await pool().end();
});
const mk = (over: Record<string, unknown> = {}) =>
  RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name: 'Dave',
    email: `dave+${randomUUID().slice(0, 6)}@example.com`,
    crew: 1,
    slotIds: [slotIds[0]],
    ...over,
  });
const args = (
  body: ReturnType<typeof mk>,
  spam = false,
  status: 'requested' | 'standby' = 'requested',
  invite = inviteId,
) => ({
  body,
  inviteId: invite,
  isTest: true,
  spam,
  mode: 'slots' as const,
  status,
  countsToward: 'weekly_cap' as const,
  bigCrew: false,
  dishName: 'The Long Lunch',
});
const create = (a: ReturnType<typeof args>) => withTx((c) => createRequestTx(c, a));
const emailsFor = (requestId: string) =>
  q<{ template: string; status: string; attempts: number }>(
    `select template, status, attempts from email_log where request_id = $1 order by template`,
    [requestId],
  );
const outboxFor = (to: string) =>
  q<{ template: string; text_body: string }>(
    `select template, text_body from dev_outbox where to_email = $1`,
    [to],
  );

describe('request intake', () => {
  it('AC6 a replayed client_key returns the same request', async () => {
    const b = mk();
    const sent = await todayCount('request_sent');
    const a1 = await create(args(b));
    const a2 = await create(args(b));
    expect(a2).toEqual({ requestId: a1.requestId, created: false });
    expect(await todayCount('request_sent')).toBe(sent + 1); // T3.11: a replay isn't a second request
  });
  it('L3 a client_key replayed from another invite is refused', async () => {
    const b = mk();
    await create(args(b));
    await expect(create(args(b, false, 'requested', personalInviteId))).rejects.toBeInstanceOf(
      ReplayConflictError,
    );
  });
  it('AC5 honeypot stores spam_suspect with no awaiting_jon_since and queues no email', async () => {
    const sent = await todayCount('request_sent');
    const { requestId } = await create(args(mk(), true));
    expect(await todayCount('request_sent')).toBe(sent); // T3.11: a honeypot hit is a bot
    const [r] = await q<{ spam_suspect: boolean; awaiting_jon_since: Date | null }>(
      `select spam_suspect, awaiting_jon_since from request where id = $1`,
      [requestId],
    );
    expect(r).toEqual({ spam_suspect: true, awaiting_jon_since: null });
    expect(await emailsFor(requestId)).toEqual([]);
  });
  it('06-F stores "Which night?" on an overnight request, and never without overnight', async () => {
    const night = (over: Record<string, unknown>) =>
      mk({ dish: 'pitch-me', slotIds: [], dates: ['2027-05-15'], pitchIdea: 'Hut trip', ...over });
    const byDate = (body: ReturnType<typeof mk>) =>
      withTx((c) => createRequestTx(c, { ...args(body), mode: 'dates', countsToward: 'big_day' }));
    const a = await byDate(night({ overnight: true, overnightNight: 'Saturday' }));
    const b = await byDate(night({ overnight: false, overnightNight: 'Saturday' }));
    const rows = await q<{ id: string; overnight_night: string | null }>(
      `select id, overnight_night from request where id = any($1)`,
      [[a.requestId, b.requestId]],
    );
    expect(rows.find((r) => r.id === a.requestId)!.overnight_night).toBe('Saturday');
    expect(rows.find((r) => r.id === b.requestId)!.overnight_night).toBeNull();
  });
  it('AC7 an existing guest row is never updated', async () => {
    const email = `same+${randomUUID().slice(0, 6)}@example.com`;
    await create(args(mk({ email, name: 'Dave' })));
    await create(args(mk({ email, name: 'Mallory' })));
    const [g] = await q<{ first_name_seen: string }>(`select first_name_seen from guest where email = $1`, [
      email,
    ]);
    expect(g!.first_name_seen).toBe('Dave');
  });
  it('T1.8 story upserts once per request', async () => {
    const { requestId } = await create(args(mk()));
    const s1 = await saveAfterSendStory(requestId, { body: 'The halibut incident', consent: true });
    const s2 = await saveAfterSendStory(requestId, { consent: false });
    expect(s2).toBe(s1);
    const [s] = await q<{ body: string; consent: boolean }>(`select body, consent from story where id = $1`, [
      s1,
    ]);
    expect(s).toEqual({ body: 'The halibut incident', consent: false });
  });
  it('T3.8.03 a filled story honeypot is stored as spam_suspect and stays flagged', async () => {
    const { requestId } = await create(args(mk()));
    const flag = async (id: string) =>
      (await q<{ spam_suspect: boolean }>(`select spam_suspect from story where id = $1`, [id]))[0]!
        .spam_suspect;
    const id = await saveAfterSendStory(requestId, { body: 'Hi', consent: true });
    expect(await flag(id)).toBe(false);
    await saveAfterSendStory(requestId, { consent: true, spam: true });
    expect(await flag(id)).toBe(true);
    await saveAfterSendStory(requestId, { body: 'Clean again', consent: true, spam: false });
    expect(await flag(id)).toBe(true); // a later clean save never clears the flag
  });
});

describe('locked ranges (T0.2 AC5, M2)', () => {
  const lockRange = (id: string, start: string, end: string | null) =>
    q(
      `update request set status = 'locked', locked_slot_id = null, locked_starts_at = $2, locked_ends_at = $3 where id = $1`,
      [id, start, end],
    );
  it('the GiST exclusion refuses two overlapping slot-less locks, and allows adjacent ones', async () => {
    const [a, b, c] = [await create(args(mk())), await create(args(mk())), await create(args(mk()))];
    await lockRange(a.requestId, '2027-06-03T19:00:00Z', '2027-06-03T21:00:00Z');
    await expect(lockRange(b.requestId, '2027-06-03T20:59:00Z', '2027-06-03T22:00:00Z')).rejects.toThrow(
      /request_no_overlap/,
    );
    await expect(
      lockRange(c.requestId, '2027-06-03T21:00:00Z', '2027-06-03T22:00:00Z'),
    ).resolves.toBeDefined(); // half-open: [19:00, 21:00) then [21:00, 22:00)
  });
  it('a locked row needs both ends (a NULL end would block the rest of the season)', async () => {
    const { requestId } = await create(args(mk()));
    await expect(lockRange(requestId, '2027-06-10T19:00:00Z', null)).rejects.toThrow(
      /request_locked_range_ck/,
    );
  });
});

describe('intake emails (H4) and the L-3 send path (M4)', () => {
  it('H4 stand-by queues and sends E6 + E2, never E1', async () => {
    const email = `standby+${randomUUID().slice(0, 6)}@example.com`;
    const b = mk({ email, slotIds: [], standbyWeek: '2027-05-10' });
    const { requestId } = await create(args(b, false, 'standby'));
    expect((await emailsFor(requestId)).map((e) => e.template)).toEqual(['E2', 'E6']);
    expect(await deliverRequestEmails(requestId)).toEqual(['sent', 'sent']);
    const out = await outboxFor(email);
    expect(out.map((o) => o.template)).toEqual(['E6']);
    expect(out[0]!.text_body).toContain('the week of May 10');
    const [e6] = await q<{ event_key: string }>(
      `select e.event_key from email_log e join audit_log a on a.id::text = e.event_key
        where e.request_id = $1 and e.template = 'E6' and a.action = 'request_created'`,
      [requestId],
    );
    expect(e6).toBeDefined(); // §6: E6 event_key = the triggering audit id
  });
  it('a request queues E1 + E2 in the transaction; delivering twice sends once', async () => {
    const email = `req+${randomUUID().slice(0, 6)}@example.com`;
    const { requestId } = await create(args(mk({ email })));
    expect(await emailsFor(requestId)).toEqual([
      { template: 'E1', status: 'pending', attempts: 0 },
      { template: 'E2', status: 'pending', attempts: 0 },
    ]);
    expect(await deliverRequestEmails(requestId)).toEqual(['sent', 'sent']);
    expect(await deliverRequestEmails(requestId)).toEqual([]);
    const out = await outboxFor(email);
    expect(out.map((o) => o.template)).toEqual(['E1']);
    expect(out[0]!.text_body).toMatch(/^Got your times:\nThu May 13 · noon–2 pm\nI’ll lock one in/); // option A, QA C
  });
  it('the general invite: the 21st request in a day queues E2 but not E1, and is still stored (B006)', async () => {
    await q(`delete from rate_limit where scope = 'requestSendInvite'`);
    try {
      // CR-02: through createRequest, which takes the cap before its transaction.
      const capped = (b: ReturnType<typeof mk>) => createRequest({ ...args(b), capGuestEmails: true });
      // A bot (the honeypot) never counts toward it: the 20 after it still get their E1.
      await createRequest({ ...args(mk(), true), capGuestEmails: true });
      for (let i = 0; i < 20; i++) {
        const { requestId } = await capped(mk());
        expect((await emailsFor(requestId)).map((e) => e.template)).toEqual(['E1', 'E2']);
      }
      const { requestId } = await capped(mk());
      expect((await emailsFor(requestId)).map((e) => e.template)).toEqual(['E2']);
      expect(await q(`select 1 from request where id = $1`, [requestId])).toHaveLength(1);
      // A personal invite is never capped.
      const own = await create(args(mk(), false, 'requested', personalInviteId));
      expect((await emailsFor(own.requestId)).map((e) => e.template)).toEqual(['E1', 'E2']);
    } finally {
      await q(`delete from rate_limit where scope = 'requestSendInvite'`);
    }
  });
  it('an idempotent replay sends what a crashed first attempt left pending', async () => {
    const email = `replay+${randomUUID().slice(0, 6)}@example.com`;
    const b = mk({ email });
    const first = await create(args(b)); // "crash": committed, never delivered
    const again = await create(args(b));
    expect(again.created).toBe(false);
    expect(await deliverRequestEmails(again.requestId)).toEqual(['sent', 'sent']);
    expect(first.requestId).toBe(again.requestId);
  });
  it('the tick re-sends a pending row after 5 min and a failed row after its back-off', async () => {
    const email = `retry+${randomUUID().slice(0, 6)}@example.com`;
    const { requestId } = await create(args(mk({ email })));
    const spy = vi.spyOn(mockMailer, 'send').mockRejectedValueOnce(new Error('provider down'));
    const inline = await deliverRequestEmails(requestId);
    spy.mockRestore();
    expect(inline.sort()).toEqual(['failed', 'sent']);
    const failed = (await emailsFor(requestId)).find((e) => e.status === 'failed')!;
    expect(failed.attempts).toBe(1);
    const [row] = await q<{ last_error: string }>(
      `select last_error from email_log where request_id = $1 and status = 'failed'`,
      [requestId],
    );
    expect(row!.last_error).toBe('Error'); // the class name, never the message
    await runTick(new Date(Date.now() + 2 * 60_000)); // not due yet
    expect((await emailsFor(requestId)).filter((e) => e.status === 'failed')).toHaveLength(1);
    await runTick(new Date(Date.now() + 6 * 60_000));
    expect((await emailsFor(requestId)).every((e) => e.status === 'sent')).toBe(true);
    expect((await outboxFor(email)).map((o) => o.template)).toEqual(['E1']);
  });
  it('the tick gives up after 4 attempts', async () => {
    const { requestId } = await create(args(mk()));
    await q(
      `update email_log set status = 'failed', attempts = 4, next_attempt_at = now() - interval '1 hour' where request_id = $1`,
      [requestId],
    );
    await runTick(new Date(Date.now() + 60 * 60_000));
    expect((await emailsFor(requestId)).map((e) => e.status)).toEqual(['failed', 'failed']);
  });
  it('E1 is idempotent per request and capped at 3 a day per recipient', async () => {
    const to = `cap+${randomUUID().slice(0, 6)}@example.com`;
    const r = async () => (await create(args(mk({ email: to }), true))).requestId; // spam: no auto-queued E1
    const ids = [await r(), await r(), await r(), await r()];
    const e1 = (id: string) =>
      sendTemplate({ template: 'E1', to, requestId: id, eventKey: id, vars: { dish: 'The Long Lunch' } });
    expect(await e1(ids[0]!)).toBe('sent');
    expect(await e1(ids[0]!)).toBe('duplicate');
    expect(await e1(ids[1]!)).toBe('sent');
    expect(await e1(ids[2]!)).toBe('sent');
    expect(await e1(ids[3]!)).toBe('capped');
    const [o] = await q<{ n: number }>(`select count(*)::int n from dev_outbox where to_email = $1`, [to]);
    expect(o!.n).toBe(3);
  });
});

describe('E1 cap under concurrency (T3.2)', () => {
  it('4 parallel E1s to one address in separate transactions: exactly 3 queued', async () => {
    const to = `race+${randomUUID().slice(0, 6)}@example.com`;
    const results = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        withTx(async (c) => {
          const r = await queueEmail(c, {
            template: 'E1',
            to,
            requestId: null,
            eventKey: `race-${i}-${randomUUID()}`,
            vars: { dish: 'The Long Lunch' },
          });
          await new Promise((res) => setTimeout(res, 150)); // keep every transaction open at once
          return r;
        }),
      ),
    );
    expect(results.filter((r) => typeof r === 'object')).toHaveLength(3);
    expect(results.filter((r) => r === 'capped')).toHaveLength(1);
    const [n] = await q<{ n: number }>(`select count(*)::int n from email_log where to_email = $1`, [to]);
    expect(n!.n).toBe(3);
    await q(`delete from email_log where to_email = $1`, [to]);
  });
});

describe('tick', () => {
  it('writes last_tick_at, materialises done and audits the transition (M7)', async () => {
    const { requestId } = await create(args(mk()));
    await q(
      `update request set status = 'locked', locked_starts_at = '2027-06-24T19:00:00Z', locked_ends_at = '2027-06-24T21:00:00Z' where id = $1`,
      [requestId],
    );
    await q(
      `insert into rate_limit (scope, key, window_start, count) values ('inviteLookup', 'old', '2027-06-01T00:00:00Z', 5)`,
    );
    const out = await runTick(new Date('2027-07-01T00:00:00Z'));
    expect(out.ran).toEqual(expect.arrayContaining(['materialise-done', 'email-retry', 'prune-old-rows']));
    const [rl] = await q<{ n: number }>(`select count(*)::int n from rate_limit where key = 'old'`);
    expect(rl!.n).toBe(0); // L13
    const [s] = await q<{ n: number }>(
      `select count(*)::int n from system_status where key = 'last_tick_at'`,
    );
    expect(s!.n).toBe(1);
    const [l] = await q<{ n: number }>(`select count(*)::int n from request where status = 'locked'`);
    expect(l!.n).toBe(0);
    const [a] = await q<{ actor: string; detail: Record<string, string> }>(
      `select actor, detail from audit_log where request_id = $1 and action = 'done'`,
      [requestId],
    );
    expect(a).toEqual({ actor: 'system', detail: { from_status: 'locked', to_status: 'done' } });
  });
});
