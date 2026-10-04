// T3.13.03 (TSD T3.13 AC1-AC3): bounces and complaints, polling (prototype mock = Resend's test addresses)
// and the Svix-verified webhook, against the test DB. Nothing leaves the machine.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getEnv } from '@/config/env';
import { report, reportMessage } from '@/lib/report';
import { mockMailer } from '@/lib/adapters/mock/mailer';
import { resetMailerModeCache } from '@/lib/adapters/mailer';
import { sendQueuedEmails } from '@/features/email/queue';
import { q, pool } from '@/lib/db';
import { mockDeliveryStatus } from '@/lib/adapters/mock/delivery-status';
import { MailerHttpError } from '@/lib/adapters/errors';
import { svixSign } from '@/lib/adapters/resend/webhook';
import { createResendStatusSource, RESEND_POLL_SPACING_MS } from '@/lib/adapters/resend/status';
import { deliverEmail, queueEmail } from '@/features/email/send';
import {
  bouncePollStatus,
  CALL_TIMEOUT_MS,
  POLL_DISABLED_KEY,
  pollDeliveryOutcomes,
  pollingSource,
} from '@/features/email/bounce-poll';
import { applyOutcome } from '@/features/email/outcome';
import { resendFailedEmail } from '@/features/email/status';
import type { TemplateId } from '@/content/emails';
import { POST as webhook } from '@/app/api/webhooks/resend/route';
import { removeRequests } from '../fixtures/requests-db';

const envOverride = vi.hoisted(
  () =>
    ({}) as { RESEND_WEBHOOK_SECRET?: string; RESEND_READ_KEY?: string; APP_MODE?: 'prototype' | 'staging' },
);
vi.mock('@/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/env')>();
  const set = () => Object.fromEntries(Object.entries(envOverride).filter(([, v]) => v !== undefined));
  return { ...actual, getEnv: () => ({ ...actual.getEnv(), ...set() }) };
});
vi.mock('@/lib/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/report')>()),
  report: vi.fn(),
  reportMessage: vi.fn(),
}));

const FAR = Date.now() + 60_000;
const SECRET = 'whsec_' + Buffer.from('test-webhook-secret-32-bytes-long!').toString('base64');

// HYG: this file's requests (Needs a reply, bounced/complained) and guests go for good in afterAll, so re-runs on one
// DB don't pile them into admin-inbox's capped tabs.
const made: string[] = [];
const madeGuests: string[] = [];
async function newRequest(email: string, status = 'requested', awaiting: Date | null = null) {
  const [inv] = await q<{ id: string }>(`select id from invite where kind = 'general' limit 1`);
  const [g] = await q<{ id: string }>(`insert into guest (email) values ($1) returning id`, [
    `g+${randomUUID().slice(0, 8)}@example.com`,
  ]);
  const [r] = await q<{ id: string }>(
    `insert into request (is_test, client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, status, counts_toward, awaiting_jon_since)
     values (true, gen_random_uuid(), $1, $2, 'Sam', $3, 'the-long-lunch', 'slots', $4, 'weekly_cap', $5) returning id`,
    [g!.id, inv!.id, email, status, awaiting],
  );
  madeGuests.push(g!.id);
  made.push(r!.id);
  return r!.id;
}
async function sent(template: TemplateId, to: string, requestId: string | null) {
  const r = await queueEmail(pool(), {
    template,
    to,
    requestId,
    eventKey: randomUUID(),
    vars: {
      dish: 'The Long Lunch',
      name: 'Sam',
      summary: '',
      adminLink: 'x',
      week: 'Mar 1',
      day: 'Mon',
      when: 'Mon',
      manageLink: 'x', // E4's placeholders (a render failure is terminal since #31's M3)
    },
  });
  if (typeof r === 'string') throw new Error(r);
  expect(await deliverEmail(r.queued, { inline: true })).toBe('sent');
  const [row] = await q<{ resend_id: string }>('select resend_id from email_log where id = $1', [r.queued]);
  return { id: r.queued, resendId: row!.resend_id };
}
/** A later tick: every check so far happened more than RECHECK_AFTER_MIN (5) minutes ago. */
const ageChecks = () =>
  q(`update email_log set delivery_checked_at = delivery_checked_at - interval '6 minutes'
      where delivery_checked_at is not null`);
const statusOf = async (id: string) =>
  (await q<{ s: string }>('select status::text as s from email_log where id = $1', [id]))[0]!.s;
const requestRow = async (id: string) =>
  (
    await q<{ contact_problem: string | null; awaiting_jon_since: Date | null }>(
      'select contact_problem::text, awaiting_jon_since from request where id = $1',
      [id],
    )
  )[0]!;

beforeEach(async () => {
  for (const k of Object.keys(envOverride)) delete envOverride[k as keyof typeof envOverride];
  vi.mocked(report).mockClear();
  vi.mocked(reportMessage).mockClear();
  vi.restoreAllMocks();
  resetMailerModeCache();
  await q(`delete from system_status where key in ($1, 'mailer_mode')`, [POLL_DISABLED_KEY]);
  await q('delete from email_queue');
  await q('delete from email_log');
  await q('delete from email_budget');
  await q('delete from email_suppression');
  await q('delete from webhook_event');
});

afterAll(async () => {
  await removeRequests(made);
  await q(`delete from guest where id = any($1::uuid[])`, [madeGuests]);
  await q('delete from email_budget'); // the next file starts with a fresh day
  await q('delete from system_status where key = $1', [POLL_DISABLED_KEY]);
});

describe('polling mode (no webhook secret)', () => {
  it('AC1: bounced@resend.dev → bounced, suppressed, contact_problem + Needs a reply; nothing more goes to it', async () => {
    expect(await pollingSource()).toBe(mockDeliveryStatus);
    const addr = `bounced+${randomUUID().slice(0, 6)}@resend.dev`;
    const req = await newRequest(addr);
    const e = await sent('E1', addr, req);
    const waiting = await queueEmail(pool(), {
      template: 'E6',
      to: addr,
      requestId: req,
      eventKey: 'later',
      vars: { week: 'Mar 1' },
    });
    expect(await pollDeliveryOutcomes(mockDeliveryStatus, FAR)).toBe(1);
    expect(await statusOf(e.id)).toBe('bounced');
    const r = await requestRow(req);
    expect(r.contact_problem).toBe('bounced');
    expect(r.awaiting_jon_since).not.toBeNull();
    expect(await q(`select reason::text from email_suppression where email = $1`, [addr])).toEqual([
      { reason: 'bounced' },
    ]);
    expect(await statusOf((waiting as { queued: string }).queued)).toBe('suppressed');
    expect(
      await queueEmail(pool(), { template: 'E4', to: addr, requestId: req, eventKey: 'x', vars: {} }),
    ).toBe('suppressed');
    expect(await q(`select action from audit_log where request_id = $1`, [req])).toEqual([
      { action: 'email_bounced' },
    ]);
    expect(await pollDeliveryOutcomes(mockDeliveryStatus, FAR)).toBe(0); // final: never asked again
  });

  it('AC2: complained@resend.dev suppresses the address', async () => {
    const addr = `complained+${randomUUID().slice(0, 6)}@resend.dev`;
    const req = await newRequest(addr);
    const e = await sent('E4', addr, req);
    await pollDeliveryOutcomes(mockDeliveryStatus, FAR);
    expect(await statusOf(e.id)).toBe('complained');
    expect(await q(`select reason::text from email_suppression where email = $1`, [addr])).toEqual([
      { reason: 'complained' },
    ]);
    expect((await requestRow(req)).contact_problem).toBe('complained');
  });

  it('AC3: at most 30 calls a tick; the next tick asks the rows not yet checked first', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) ids.push((await sent('E1', `pending${i}@example.com`, null)).id);
    const asked: string[] = [];
    const src = {
      status: vi.fn(async (_id: string, to: string) => {
        asked.push(to);
        return 'pending' as const;
      }),
    };
    expect(await pollDeliveryOutcomes(src, FAR)).toBe(30);
    expect(await pollDeliveryOutcomes(src, FAR)).toBe(10); // right away: only the 10 never asked (N1)
    await ageChecks();
    asked.length = 0;
    expect(await pollDeliveryOutcomes(src, FAR, 100)).toBe(30); // a later tick; the cap holds whatever is asked
    expect(asked.slice(0, 30).sort()).toEqual(
      Array.from({ length: 30 }, (_, i) => `pending${i}@example.com`).sort(), // least recently checked first
    );
  });

  it('delivered ends polling; rows over 72 h are left alone; a 401 stops the tick', async () => {
    const d = await sent('E1', 'fine@example.com', null);
    const old = await sent('E1', 'bounced-old@resend.dev', null);
    await q(`update email_log set created_at = now() - interval '73 hours' where id = $1`, [old.id]);
    expect(await pollDeliveryOutcomes(mockDeliveryStatus, FAR)).toBe(1);
    expect(await statusOf(d.id)).toBe('sent');
    expect(await statusOf(old.id)).toBe('sent');
    expect(await pollDeliveryOutcomes(mockDeliveryStatus, FAR)).toBe(0);

    await sent('E1', 'a@example.com', null);
    await sent('E1', 'b@example.com', null);
    const failing = { status: vi.fn(async () => Promise.reject(new MailerHttpError(401))) };
    expect(await pollDeliveryOutcomes(failing, FAR)).toBe(1);
    expect(failing.status).toHaveBeenCalledTimes(1);
  });

  it("Jon's own inbox is never suppressed; a closed request isn't put back in Needs a reply", async () => {
    const e2 = await sent('E2', 'bounced-jon@resend.dev', null);
    await pollDeliveryOutcomes(mockDeliveryStatus, FAR);
    expect(await statusOf(e2.id)).toBe('bounced');
    expect(await q('select 1 from email_suppression')).toHaveLength(0);

    const addr = `bounced+${randomUUID().slice(0, 6)}@resend.dev`;
    const req = await newRequest(addr, 'cancelled');
    await sent('E11', addr, req);
    await pollDeliveryOutcomes(mockDeliveryStatus, FAR);
    expect(await requestRow(req)).toEqual({ contact_problem: 'bounced', awaiting_jon_since: null });

    const since = new Date(Date.now() - 3 * 86_400_000);
    const addr2 = `bounced+${randomUUID().slice(0, 6)}@resend.dev`;
    const req2 = await newRequest(addr2, 'requested', since);
    await sent('E1', addr2, req2);
    await pollDeliveryOutcomes(mockDeliveryStatus, FAR);
    expect((await requestRow(req2)).awaiting_jon_since?.getTime()).toBe(since.getTime()); // the wait keeps its start
  });

  it('a suppressed address has no failed row left to Resend', async () => {
    const addr = `bounced+${randomUUID().slice(0, 6)}@resend.dev`;
    await sent('E1', addr, null);
    const f = await queueEmail(pool(), {
      template: 'E6',
      to: addr,
      requestId: null,
      eventKey: 'f',
      vars: { week: 'x' },
    });
    const fid = (f as { queued: string }).queued;
    await q(`update email_log set status = 'failed' where id = $1`, [fid]);
    await pollDeliveryOutcomes(mockDeliveryStatus, FAR);
    expect(await statusOf(fid)).toBe('suppressed');
    expect(await resendFailedEmail(fid)).toBe('not_found');
  });

  it('a row sent by the Gmail mailer (gmail: id) is never claimed for a Resend status call', async () => {
    const g = await sent('E1', 'via-gmail@example.com', null);
    await q(`update email_log set resend_id = 'gmail:' || id where id = $1`, [g.id]);
    const r = await sent('E1', 'via-resend@example.com', null);
    const src = { status: vi.fn(async () => 'pending' as const) };
    expect(await pollDeliveryOutcomes(src, FAR)).toBe(1);
    expect(src.status).toHaveBeenCalledTimes(1);
    expect(src.status).toHaveBeenCalledWith(r.resendId, 'via-resend@example.com', expect.any(Number));
    const [row] = await q<{ c: Date | null }>(
      'select delivery_checked_at as c from email_log where id = $1',
      [g.id],
    );
    expect(row!.c).toBeNull();
  });

  it('no polling when the webhook secret is set', async () => {
    envOverride.RESEND_WEBHOOK_SECRET = SECRET;
    expect(await pollingSource()).toBeNull();
  });
});

describe('pr34 review: read key, latch, timeout, pacing, claims, races', () => {
  const poll = (src: Parameters<typeof pollDeliveryOutcomes>[0], deadline = FAR) =>
    pollDeliveryOutcomes(src, deadline);

  it('M1: outside prototype, polling needs RESEND_READ_KEY (the send key is sending-only)', async () => {
    envOverride.APP_MODE = 'staging';
    await q(`insert into system_status (key, value) values ('mailer_mode', 'resend')`);
    expect(await pollingSource()).toBeNull();
    envOverride.RESEND_READ_KEY = 're_read_1';
    resetMailerModeCache();
    const f = vi.fn(async () => new Response(JSON.stringify({ last_event: 'delivered' })));
    vi.stubGlobal('fetch', f); // never the network: the source binds fetch when it's built
    try {
      const src = await pollingSource();
      expect(src).not.toBeNull();
      expect(src).not.toBe(mockDeliveryStatus);
      await src!.status('re_1', 'a@example.com');
    } finally {
      vi.unstubAllGlobals();
    }
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ Authorization: 'Bearer re_read_1' }); // the read key, not the send key
    await q(`update system_status set value = 'gmail_api' where key = 'mailer_mode'`);
    resetMailerModeCache();
    expect(await pollingSource()).toBeNull(); // not sending through Resend: nothing to poll
  });

  it('M1: a 401/403 latches polling off with ONE report, until the read key changes', async () => {
    envOverride.RESEND_READ_KEY = 're_read_1';
    await sent('E1', 'a@example.com', null);
    const refused = { status: vi.fn(async () => Promise.reject(new MailerHttpError(403))) };
    expect(await poll(refused)).toBe(1);
    expect(reportMessage).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    expect(await pollingSource()).toBeNull();
    expect(await bouncePollStatus()).toMatchObject({ disabled: true, status: 403 });
    const [latch] = await q<{ value: string }>('select value from system_status where key = $1', [
      POLL_DISABLED_KEY,
    ]);
    expect(latch!.value).not.toContain('re_read_1'); // a fingerprint, never the key
    await q(`update email_log set delivery_checked_at = null`);
    await poll(refused); // the same key refused again: no second report
    expect(reportMessage).toHaveBeenCalledTimes(1);

    envOverride.RESEND_READ_KEY = 're_read_2'; // a new key clears the latch
    expect(await bouncePollStatus()).toEqual({ disabled: false });
    expect(await pollingSource()).toBe(mockDeliveryStatus);
    expect(await q('select 1 from system_status where key = $1', [POLL_DISABLED_KEY])).toHaveLength(0);
    await q(`update email_log set delivery_checked_at = null`);
    await poll(refused);
    expect(reportMessage).toHaveBeenCalledTimes(2); // the new key refused: reported once more
  });

  it('M2/M3: a timeout or a 429 ends the tick quietly; a 5xx ends it with a report', async () => {
    for (let i = 0; i < 3; i++) await sent('E1', `p${i}@example.com`, null);
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    for (const [err, reported] of [
      [timeout, false],
      [new MailerHttpError(429), false],
      [new MailerHttpError(503), true],
    ] as const) {
      vi.mocked(report).mockClear();
      await q(`update email_log set delivery_checked_at = null`);
      const src = { status: vi.fn(async () => Promise.reject(err)) };
      expect(await poll(src)).toBe(1);
      expect(vi.mocked(report).mock.calls.length > 0).toBe(reported);
    }
    expect(reportMessage).not.toHaveBeenCalled();
    expect(await q('select 1 from system_status where key = $1', [POLL_DISABLED_KEY])).toHaveLength(0);
  });

  it('M2: each call gets a timeout of at most 3 s and never past the tick deadline', async () => {
    await sent('E1', 'a@example.com', null);
    await sent('E1', 'b@example.com', null);
    const timeouts: number[] = [];
    const src = {
      status: vi.fn(async (_id: string, _to: string, t?: number) => {
        timeouts.push(t!);
        return 'pending' as const;
      }),
    };
    await poll(src);
    expect(timeouts).toHaveLength(2);
    for (const t of timeouts) expect(t).toBe(CALL_TIMEOUT_MS);
    await q(`update email_log set delivery_checked_at = null`);
    timeouts.length = 0;
    await poll(src, Date.now() + 1000);
    for (const t of timeouts) expect(t).toBeLessThanOrEqual(1000);
    expect(await poll(src, Date.now() - 1)).toBe(0); // no budget left: no call at all
  });

  it('M3: calls are paced, and a pause that would pass the deadline ends the tick', async () => {
    for (let i = 0; i < 3; i++) await sent('E1', `p${i}@example.com`, null);
    const src = { spacingMs: 40, status: vi.fn(async () => 'pending' as const) };
    const t0 = Date.now();
    expect(await pollDeliveryOutcomes(src, FAR)).toBe(3);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(75);
    await q(`update email_log set delivery_checked_at = null`);
    // Margins wide enough for a slow CI host (the claim query runs before the first call).
    const slow = { spacingMs: 3000, status: vi.fn(async () => 'pending' as const) };
    const t1 = Date.now();
    expect(await pollDeliveryOutcomes(slow, Date.now() + 1500)).toBe(1);
    expect(Date.now() - t1).toBeLessThan(2500); // no pause that ends past the deadline
    expect(createResendStatusSource('k').spacingMs).toBe(RESEND_POLL_SPACING_MS);
    expect(RESEND_POLL_SPACING_MS).toBeGreaterThanOrEqual(100); // ≤ 10 calls/s, Resend's team limit
  });

  it('L7: rows another tick holds are skipped, not waited on; the claim keeps the round-robin order', async () => {
    for (let i = 0; i < 4; i++) await sent('E1', `p${i}@example.com`, null);
    const asked: string[] = [];
    const src = {
      status: vi.fn(async (_id: string, to: string) => {
        asked.push(to);
        return 'pending' as const;
      }),
    };
    expect(await pollDeliveryOutcomes(src, FAR, 1)).toBe(1); // p0 is now the most recently checked
    await ageChecks(); // a later tick
    asked.length = 0;
    expect(await pollDeliveryOutcomes(src, FAR, 4)).toBe(4);
    expect(asked).toEqual(['p1@example.com', 'p2@example.com', 'p3@example.com', 'p0@example.com']);
    await ageChecks();

    const holder = await pool().connect();
    try {
      await holder.query('begin');
      await holder.query(
        `select id from email_log where to_email in ('p1@example.com', 'p2@example.com') for update`,
      );
      asked.length = 0;
      const n = await Promise.race([
        pollDeliveryOutcomes(src, FAR, 4),
        new Promise<string>((r) => setTimeout(() => r('blocked'), 1500)),
      ]);
      expect(n).toBe(2);
      expect(asked.sort()).toEqual(['p0@example.com', 'p3@example.com']);
    } finally {
      await holder.query('rollback');
      holder.release();
    }
  });

  it('L7 race (pr54 F8): a claim waits for a concurrent claim to commit, then never takes its rows', async () => {
    for (let i = 0; i < 4; i++) await sent('E1', `p${i}@example.com`, null);
    const asked: string[] = [];
    const src = {
      status: vi.fn(async (_id: string, to: string) => {
        asked.push(to);
        return 'pending' as const;
      }),
    };
    // Another tick's claim, mid-transaction: it holds the claim lock and has marked p0 + p1 as checked.
    const other = await pool().connect();
    let settled = false;
    try {
      await other.query('begin');
      await other.query(`select pg_advisory_xact_lock(hashtext('twj_bounce_poll_claim'))`);
      await other.query(
        `update email_log set delivery_checked_at = now() where to_email in ('p0@example.com', 'p1@example.com')`,
      );
      const poll = pollDeliveryOutcomes(src, FAR, 2).finally(() => (settled = true));
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false); // it waits for the lock instead of claiming against a stale snapshot
      await other.query('commit');
      expect(await poll).toBe(2);
    } finally {
      await other.query('rollback').catch(() => {});
      other.release();
    }
    expect(asked.sort()).toEqual(['p2@example.com', 'p3@example.com']); // the rows the other tick left
  });

  it('pr42-verify N1: with few rows, back-to-back or overlapping polls never ask a row twice', async () => {
    for (let i = 0; i < 2; i++) await sent('E1', `p${i}@example.com`, null);
    const src = { status: vi.fn(async () => 'pending' as const) };
    await Promise.all([pollDeliveryOutcomes(src, FAR), pollDeliveryOutcomes(src, FAR)]);
    expect(await pollDeliveryOutcomes(src, FAR)).toBe(0);
    expect(src.status).toHaveBeenCalledTimes(2); // 2 rows, 3 polls: 2 asks (it was 4+)
    await ageChecks(); // 5 minutes on, they are due again
    expect(await pollDeliveryOutcomes(src, FAR)).toBe(2);
  });

  it('L7: overlapping ticks claim different rows', async () => {
    for (let i = 0; i < 4; i++) await sent('E1', `p${i}@example.com`, null);
    const asked: string[] = [];
    const slow = {
      status: vi.fn(async (_id: string, to: string) => {
        asked.push(to);
        await new Promise((r) => setTimeout(r, 20));
        return 'pending' as const;
      }),
    };
    await Promise.all([pollDeliveryOutcomes(slow, FAR, 2), pollDeliveryOutcomes(slow, FAR, 2)]);
    // Serialised claims: the second tick takes the two rows the first didn't; never one row twice.
    expect(asked).toHaveLength(4);
    expect(new Set(asked).size).toBe(4);
  });

  it('M4: a queued (next-day) email to the bounced address is suppressed and never sent', async () => {
    const addr = `bounced+${randomUUID().slice(0, 6)}@resend.dev`;
    await sent('E1', addr, null);
    await q(
      `insert into email_budget (utc_day, sent_count) values ((now() at time zone 'utc')::date, 85)
       on conflict (utc_day) do update set sent_count = 85, limit_hit_at = null`,
    );
    const r = await queueEmail(pool(), {
      template: 'E1',
      to: addr,
      requestId: null,
      eventKey: 'q',
      vars: {
        dish: 'The Long Lunch',
        name: 'Sam',
        summary: '',
        adminLink: 'x',
        week: 'Mar 1',
      },
    });
    const qid = (r as { queued: string }).queued;
    expect(await deliverEmail(qid, { inline: true })).toBe('queued');
    await poll(mockDeliveryStatus);
    expect(await statusOf(qid)).toBe('suppressed');
    const spy = vi.spyOn(mockMailer, 'send');
    await sendQueuedEmails(new Date(Date.now() + 2 * 86_400_000), FAR);
    expect(spy).not.toHaveBeenCalled();
    expect(await statusOf(qid)).toBe('suppressed');
  });

  it("L4: a guest template bounced by Jon's own address never suppresses it", async () => {
    const jon = getEnv().ADMIN_EMAILS[0]!;
    const e = await sent('E1', jon, null);
    await withBounce(e.resendId);
    expect(await statusOf(e.id)).toBe('bounced');
    expect(await q('select 1 from email_suppression')).toHaveLength(0);
    expect(reportMessage).toHaveBeenCalledTimes(1);
  });

  it('L5: an address suppressed after queueing is not sent; the slot is refunded', async () => {
    const r = await queueEmail(pool(), {
      template: 'E1',
      to: 'late@example.com',
      requestId: null,
      eventKey: 'l5',
      vars: { dish: 'The Long Lunch', name: 'Sam', summary: '', adminLink: 'x', week: 'Mar 1' },
    });
    const id = (r as { queued: string }).queued;
    await q(`insert into email_suppression (email, reason) values ('late@example.com', 'bounced')`);
    const spy = vi.spyOn(mockMailer, 'send');
    expect(await deliverEmail(id, { inline: true })).toBe('skipped');
    expect(spy).not.toHaveBeenCalled();
    expect(await statusOf(id)).toBe('suppressed');
    const [b] = await q<{ n: number }>(
      `select coalesce(sum(sent_count), 0)::int as n from email_budget where utc_day = (now() at time zone 'utc')::date`,
    );
    expect(b!.n).toBe(0);
  });

  it('L5: a suppression that lands during the send keeps its status; the provider id is recorded', async () => {
    const r = await queueEmail(pool(), {
      template: 'E1',
      to: 'mid@example.com',
      requestId: null,
      eventKey: 'l5b',
      vars: { dish: 'The Long Lunch', name: 'Sam', summary: '', adminLink: 'x', week: 'Mar 1' },
    });
    const id = (r as { queued: string }).queued;
    const original = mockMailer.send.bind(mockMailer);
    vi.spyOn(mockMailer, 'send').mockImplementation(async (m) => {
      await q(`update email_log set status = 'suppressed' where id = $1`, [id]);
      return original(m);
    });
    expect(await deliverEmail(id, { inline: true })).toBe('sent');
    const [row] = await q<{ s: string; r: string | null }>(
      'select status::text as s, resend_id as r from email_log where id = $1',
      [id],
    );
    expect(row).toEqual({ s: 'suppressed', r: expect.any(String) });
  });
});

const withBounce = (resendId: string) => applyOutcome(pool(), resendId, 'bounced');

describe('webhook mode', () => {
  const call = (body: string, opts: { id?: string; ts?: number; sig?: string } = {}) => {
    const id = opts.id ?? `msg_${randomUUID()}`;
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const sig = opts.sig ?? `v1,${svixSign(SECRET, id, ts, body)}`;
    return webhook(
      new NextRequest(`${getEnv().NEXT_PUBLIC_SITE_URL}/api/webhooks/resend`, {
        method: 'POST',
        headers: {
          'svix-id': id,
          'svix-timestamp': ts,
          'svix-signature': sig,
          'content-type': 'application/json',
        },
        body,
      }),
    );
  };
  const event = (type: string, emailId: string) =>
    JSON.stringify({ type, data: { email_id: emailId, to: ['x'] } });

  it('404 when no secret is configured', async () => {
    expect((await call(event('email.bounced', 'x'))).status).toBe(404);
  });

  it('a signed email.bounced applies once; the same svix-id again is a duplicate', async () => {
    envOverride.RESEND_WEBHOOK_SECRET = SECRET;
    const addr = `dave+${randomUUID().slice(0, 6)}@example.com`;
    const req = await newRequest(addr);
    const e = await sent('E4', addr, req);
    const body = event('email.bounced', e.resendId);
    const res = await call(body, { id: 'msg_1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: 'applied' });
    expect(await statusOf(e.id)).toBe('bounced');
    expect((await requestRow(req)).contact_problem).toBe('bounced');
    expect(await (await call(body, { id: 'msg_1' })).json()).toEqual({ ok: true, outcome: 'duplicate' });
    expect(await (await call(body, { id: 'msg_2' })).json()).toEqual({ ok: true, outcome: 'ignored' });
  });

  it('a bounce for an email not recorded yet is 503 with nothing stored; the redelivery after the send applies', async () => {
    envOverride.RESEND_WEBHOOK_SECRET = SECRET;
    const addr = `early+${randomUUID().slice(0, 6)}@example.com`;
    const req = await newRequest(addr);
    const early = `re_${randomUUID()}`;
    const body = event('email.bounced', early);
    const res = await call(body, { id: 'msg_early' });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(await q('select 1 from webhook_event')).toHaveLength(0);
    const e = await sent('E4', addr, req);
    await q(`update email_log set resend_id = $2 where id = $1`, [e.id, early]); // the send's update lands
    expect(await (await call(body, { id: 'msg_early' })).json()).toEqual({ ok: true, outcome: 'applied' });
    expect(await statusOf(e.id)).toBe('bounced');
    expect((await requestRow(req)).contact_problem).toBe('bounced');
    // A complaint is retried the same way; a delivered for an unknown id is acknowledged.
    expect((await call(event('email.complained', `re_${randomUUID()}`))).status).toBe(503);
    expect(await (await call(event('email.delivered', `re_${randomUUID()}`))).json()).toEqual({
      ok: true,
      outcome: 'ignored',
    });
  });

  it('email.complained suppresses; email.delivered ends polling; other types are acknowledged', async () => {
    envOverride.RESEND_WEBHOOK_SECRET = SECRET;
    const a = await sent('E1', 'c1@example.com', null);
    expect((await call(event('email.complained', a.resendId))).status).toBe(200);
    expect(await q(`select reason::text from email_suppression`)).toEqual([{ reason: 'complained' }]);
    const b = await sent('E1', 'c2@example.com', null);
    await call(event('email.delivered', b.resendId));
    const [row] = await q<{ f: Date | null }>('select delivery_final_at as f from email_log where id = $1', [
      b.id,
    ]);
    expect(row!.f).not.toBeNull();
    expect(await (await call(event('email.opened', b.resendId))).json()).toEqual({ ok: true, ignored: true });
  });

  it('refuses a bad signature, a stale timestamp, a bad payload and an oversized body', async () => {
    envOverride.RESEND_WEBHOOK_SECRET = SECRET;
    const body = event('email.bounced', 'x');
    expect((await call(body, { sig: 'v1,AAAA' })).status).toBe(401);
    expect((await call(body, { ts: Math.floor(Date.now() / 1000) - 301 })).status).toBe(401);
    expect((await call('not json')).status).toBe(400);
    expect((await call(JSON.stringify({ type: 'email.bounced', data: {} }))).status).toBe(400);
    expect((await call('x'.repeat(64 * 1024 + 1))).status).toBe(413);
    expect(await q('select 1 from webhook_event')).toHaveLength(0);
  });

  it('pr34 L1-L3: other event types need no email_id; odd svix-ids and oversize bodies are refused', async () => {
    envOverride.RESEND_WEBHOOK_SECRET = SECRET;
    const other = await call(JSON.stringify({ type: 'contact.created', data: { id: 'c' } }));
    expect(await other.json()).toEqual({ ok: true, ignored: true });
    expect((await call(JSON.stringify({ data: {} }))).status).toBe(400);
    expect((await call(event('email.bounced', 'x'), { id: 'm'.repeat(201) })).status).toBe(401);
    expect((await call(event('email.bounced', 'x'), { id: 'msg_1/../x' })).status).toBe(401);
    // 64 KB of UTF-16 units, but more than 64 KB of bytes
    expect((await call('é'.repeat(40 * 1024))).status).toBe(413);
    const declared = await webhook(
      new NextRequest(`${getEnv().NEXT_PUBLIC_SITE_URL}/api/webhooks/resend`, {
        method: 'POST',
        headers: { 'content-length': String(64 * 1024 + 1) },
        body: '{}',
      }),
    );
    expect(declared.status).toBe(413);
  });
});
