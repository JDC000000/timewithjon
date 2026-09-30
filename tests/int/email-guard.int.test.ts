// T3.2.05/.06/.07/.08/.09 (TSD T3.2 AC2, AC5, AC6, AC7): the AD-5 guard in the real send path, against the
// test DB. The prototype mailer writes to dev_outbox; a spy on it scripts Resend's answers. Nothing is sent.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { q, pool } from '@/lib/db';
import { mockMailer } from '@/lib/adapters/mock/mailer';
import {
  MailerHttpError,
  MailerInvalidMessageError,
  MailerNotConfiguredError,
  MailerQuotaError,
} from '@/lib/adapters/errors';
import { resetMailerModeCache } from '@/lib/adapters/mailer';
import type { TemplateId } from '@/content/emails';
import {
  deliverEmail,
  deliverRequestEmails,
  MAX_ATTEMPTS,
  queueEmail,
  retryDueEmails,
} from '@/features/email/send';
import { claimQueued, sendQueuedEmails } from '@/features/email/queue';
import { sendHourlyDigest } from '@/features/email/digest';
import {
  budgetHitTwoDaysRunning,
  emailLimit,
  failedEmails,
  resendFailedEmail,
} from '@/features/email/status';
import { sendAdminSignIn } from '@/features/admin/signin';
import { sendOtpEmail, currentAuthEmail } from '@/features/admin/supabase';
import { GET as getEmailStatus } from '@/app/api/admin/email/route';
import { POST as resendRoute } from '@/app/api/admin/email/[id]/resend/route';

vi.mock('@/features/admin/supabase', () => ({ sendOtpEmail: vi.fn(), currentAuthEmail: vi.fn() }));
const ADMIN = 'jon@example.com';
const SITE = 'http://localhost:3000';
const FAR = Date.now() + 60_000;

const sendSpy = vi.spyOn(mockMailer, 'send');
let n = 0;
async function queued(template: TemplateId, vars: Record<string, string | number> = {}) {
  const r = await queueEmail(pool(), {
    template,
    to: template === 'E2' || template === 'E13' ? ADMIN : `guest${++n}@example.com`,
    requestId: null,
    eventKey: `t-${++n}`,
    vars: { dish: 'The Long Lunch', name: 'Dave', summary: 'Crew 2.', adminLink: 'x', ...vars },
  });
  if (typeof r === 'string') throw new Error(r);
  return r.queued;
}
async function setCount(sent: number) {
  await q(
    `insert into email_budget (utc_day, sent_count) values ((now() at time zone 'utc')::date, $1)
     on conflict (utc_day) do update set sent_count = $1, limit_hit_at = null`,
    [sent],
  );
}
async function count() {
  const r = await q<{ n: number }>(
    `select sent_count as n from email_budget where utc_day = (now() at time zone 'utc')::date`,
  );
  return r[0]?.n ?? 0;
}
async function logRow(id: string) {
  const [r] = await q<{ status: string; attempts: number }>(
    'select status::text, attempts from email_log where id = $1',
    [id],
  );
  return r!;
}
async function queueRow(id: string) {
  const [r] = await q<{ kind: string; priority: number; not_before: Date; sent_at: Date | null }>(
    'select kind, priority, not_before, sent_at from email_queue where email_log_id = $1',
    [id],
  );
  return r;
}
/** The next UTC day starts: a fresh counter row (the DB's day can't be moved, so today's row is reset). */
async function newUtcDay() {
  await q('delete from email_budget');
}
const sentTemplates = () => sendSpy.mock.calls.map((c) => c[0].template);

beforeEach(async () => {
  await q('delete from email_queue');
  await q('delete from email_log');
  await q('delete from email_budget');
  await q('delete from dev_outbox');
  sendSpy.mockClear();
  vi.mocked(sendOtpEmail).mockReset().mockResolvedValue({ error: null });
  vi.mocked(currentAuthEmail).mockReset().mockResolvedValue(ADMIN);
});

// Other files send email too: never leave today's counter full or marked for them (the files share one DB).
afterAll(async () => {
  await q('delete from email_queue');
  await q('delete from email_budget');
});

describe('AC5: the thresholds in the real send path', () => {
  it('at 60 a new E2 goes into the hourly digest; the digest sends ONE E13 with its subject, once', async () => {
    await setCount(60);
    const e2 = await queued('E2');
    const now = new Date();
    expect(await deliverEmail(e2, { inline: true, now })).toBe('digested');
    expect(sendSpy).not.toHaveBeenCalled();
    expect(await count()).toBe(60); // a parked email takes no slot
    expect(await logRow(e2)).toEqual({ status: 'queued', attempts: 0 });
    const wait = await queueRow(e2);
    expect(wait?.kind).toBe('digest');
    expect(wait?.not_before.getTime()).toBeGreaterThan(now.getTime());

    expect(await sendHourlyDigest(now)).toBe('none'); // not due before the top of the hour
    const later = new Date(wait!.not_before.getTime() + 60_000);
    expect(await sendQueuedEmails(later, FAR)).toBe(0); // the next-day queue never sends a digest row
    expect(sendSpy).not.toHaveBeenCalled();
    expect(await sendHourlyDigest(later)).toBe('sent');
    expect(sentTemplates()).toEqual(['E13']);
    const digest = sendSpy.mock.calls[0]![0];
    expect(digest.to).toBe(ADMIN);
    expect(digest.text).toContain('- New request: The Long Lunch from Dave');
    expect(digest.text).not.toContain('Crew 2.'); // the subject only, never the body
    expect((await logRow(e2)).status).toBe('digested');
    expect(await sendHourlyDigest(later)).toBe('none');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await count()).toBe(61);
  });

  it('a parked row that is no longer queued is never folded into a digest', async () => {
    await setCount(60);
    const e2 = await queued('E2');
    expect(await deliverEmail(e2, { inline: true })).toBe('digested');
    await q(`update email_log set status = 'sent' where id = $1`, [e2]); // another path got there first
    const wait = await queueRow(e2);
    expect(await sendHourlyDigest(new Date(wait!.not_before.getTime() + 1))).toBe('none');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('several P3 emails in one hour collapse into one digest; P2 at 60 still sends', async () => {
    await setCount(70);
    const ids = [await queued('E2'), await queued('E16'), await queued('E3')];
    for (const id of ids) expect(await deliverEmail(id, { inline: true })).toBe('digested');
    expect(await deliverEmail(await queued('E1'), { inline: true })).toBe('sent');
    const [wait] = await q<{ t: Date }>(`select max(not_before) as t from email_queue`);
    expect(await sendHourlyDigest(new Date(wait!.t.getTime() + 1))).toBe('sent');
    expect(sentTemplates()).toEqual(['E1', 'E13']);
    expect(sendSpy.mock.calls[1]![0].subject).toBe('New stories: 3');
  });

  it('at 85 an E1 is queued for 00:05 UTC and an E4 still sends; at 95 the E4 waits and the banner shows', async () => {
    await setCount(85);
    const now = new Date('2027-03-01T18:30:00Z');
    const e1 = await queued('E1');
    const e2 = await queued('E2');
    const e4 = await queued('E4', { day: 'Mon', when: 'Mon', manageLink: 'x' });
    expect(await deliverEmail(e1, { inline: true, now })).toBe('queued');
    expect(await deliverEmail(e2, { inline: true, now })).toBe('queued'); // P3 at 85 waits, not digested
    expect(await deliverEmail(e4, { inline: true, now })).toBe('sent');
    expect((await queueRow(e1))?.not_before.toISOString()).toBe('2027-03-02T00:05:00.000Z');
    expect((await queueRow(e1))?.kind).toBe('next_day');
    expect((await emailLimit()).reached).toBe(false);

    await setCount(95);
    const e4b = await queued('E4', { day: 'Tue', when: 'Tue', manageLink: 'x' });
    expect(await deliverEmail(e4b, { inline: true, now })).toBe('queued');
    const limit = await emailLimit();
    expect(limit.reached).toBe(true);
    expect(limit.resumesAt).toMatch(/T00:05:00\.000Z$/);
    expect(limit.resumesAtLocal).toMatch(/^\d{1,2}:05 (AM|PM)$/);

    // a sign-in still goes out, and is counted (P0, within its cap)
    expect(await sendAdminSignIn(ADMIN, 'prototype')).toBe('sent');
    expect(await count()).toBe(96);
  });

  it('queued emails go out the next UTC day in priority, then age, order, exactly once', async () => {
    await setCount(95);
    const now = new Date('2027-03-01T18:30:00Z');
    const order: [TemplateId, string][] = [];
    for (const t of ['E2', 'E1', 'E4', 'E6', 'E12', 'E5'] as TemplateId[]) {
      const id = await queued(t, {
        day: 'Mon',
        when: 'Mon',
        manageLink: 'x',
        week: 'Mar 1',
        lead: 'Hi',
        times: '-',
        takeLink: 'x',
        standby: 'none',
      });
      expect(await deliverEmail(id, { inline: true, now })).toBe('queued');
      order.push([t, id]);
    }
    expect(await sendQueuedEmails(now, FAR)).toBe(0); // not before 00:05 UTC
    await newUtcDay();
    const tomorrow = new Date('2027-03-02T00:10:00Z');
    const [a, b] = await Promise.all([sendQueuedEmails(tomorrow, FAR), sendQueuedEmails(tomorrow, FAR)]);
    expect(a + b).toBe(6);
    expect(await sendQueuedEmails(tomorrow, FAR)).toBe(0);
    expect(sentTemplates().sort()).toEqual(['E1', 'E12', 'E2', 'E4', 'E5', 'E6']);
    // one runner alone keeps the order strictly
    sendSpy.mockClear();
    await q('delete from email_queue');
    await q('delete from email_log');
    await setCount(95);
    for (const t of ['E2', 'E1', 'E4', 'E6', 'E12', 'E5'] as TemplateId[]) {
      const id = await queued(t, {
        day: 'Mon',
        when: 'Mon',
        manageLink: 'x',
        week: 'Mar 1',
        lead: 'Hi',
        times: '-',
        takeLink: 'x',
        standby: 'none',
      });
      await deliverEmail(id, { inline: true, now });
    }
    await newUtcDay();
    expect(await sendQueuedEmails(tomorrow, FAR)).toBe(6);
    expect(sentTemplates()).toEqual(['E4', 'E5', 'E1', 'E6', 'E2', 'E12']);
    const statuses = await q<{ status: string }>(`select distinct status::text from email_log`);
    expect(statuses).toEqual([{ status: 'sent' }]);
    expect(await count()).toBe(6);
  });

  it('a queued email that finds the new day full again waits for the next 00:05, not re-sent', async () => {
    await setCount(90);
    const e1 = await queued('E1');
    expect(await deliverEmail(e1, { inline: true, now: new Date('2027-03-01T18:00:00Z') })).toBe('queued');
    const tomorrow = new Date('2027-03-02T00:10:00Z');
    expect(await sendQueuedEmails(tomorrow, FAR)).toBe(0); // the DB day is still at 90
    expect((await queueRow(e1))?.not_before.toISOString()).toBe('2027-03-03T00:05:00.000Z');
    expect((await queueRow(e1))?.sent_at).toBeNull();
    expect(await logRow(e1)).toEqual({ status: 'queued', attempts: 0 });
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('AC6: app email never takes the counter past 95', () => {
  it('20 P1 sends at once from 90: exactly 5 go out, the rest wait', async () => {
    await setCount(90);
    const ids = await Promise.all(Array.from({ length: 20 }, () => queued('E11')));
    const results = await Promise.all(ids.map((id) => deliverEmail(id, { inline: true })));
    expect(results.filter((r) => r === 'sent')).toHaveLength(5);
    expect(results.filter((r) => r === 'queued')).toHaveLength(15);
    expect(await count()).toBe(95);
  });
  it('a sign-in at 95+ is counted as P0 and never queued; its cap still holds', async () => {
    await setCount(99);
    expect(await sendAdminSignIn(ADMIN, 'prototype')).toBe('sent');
    expect(await sendAdminSignIn(ADMIN, 'prototype')).toBe('sent');
    expect(await sendAdminSignIn(ADMIN, 'prototype')).toBe('capped'); // proto P0 cap = 2
    expect(await count()).toBe(101);
    expect(await q('select 1 from email_queue')).toHaveLength(0);
  });
});

describe('AC7: a Resend quota 429', () => {
  it('is not retried: the email waits for the next UTC day, the banner shows, the day counts as full', async () => {
    await setCount(10);
    sendSpy.mockRejectedValueOnce(new MailerQuotaError('resend quota'));
    const now = new Date('2027-03-01T12:00:00Z');
    const e4 = await queued('E4', { day: 'Mon', when: 'Mon', manageLink: 'x' });
    expect(await deliverEmail(e4, { inline: true, now })).toBe('queued');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await count()).toBe(10); // refunded
    expect(await logRow(e4)).toEqual({ status: 'queued', attempts: 0 });
    expect((await queueRow(e4))?.not_before.toISOString()).toBe('2027-03-02T00:05:00.000Z');
    expect((await emailLimit()).reached).toBe(true);
    // the rest of the day waits without calling Resend again; a sign-in still goes out
    expect(await deliverEmail(await queued('E1'), { inline: true, now })).toBe('queued');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await sendAdminSignIn(ADMIN, 'prototype')).toBe('sent');
    // the email-retry path never touches a queued row
    expect(await q(`select 1 from email_log where status in ('pending','failed')`)).toHaveLength(0);
  });
});

describe('failures and the counter', () => {
  it('a definite non-send (4xx, no mailer) is refunded; a 5xx or 409 keeps the slot (it may have gone out)', async () => {
    await setCount(10);
    sendSpy.mockRejectedValueOnce(new MailerHttpError(422));
    const a = await queued('E1');
    expect(await deliverEmail(a, { inline: true })).toBe('failed');
    expect(await count()).toBe(10);
    sendSpy.mockRejectedValueOnce(new MailerHttpError(499));
    expect(await deliverEmail(await queued('E1'), { inline: true })).toBe('failed');
    expect(await count()).toBe(10);
    sendSpy.mockRejectedValueOnce(new MailerNotConfiguredError('no key')); // pr31 review L1
    expect(await deliverEmail(await queued('E1'), { inline: true })).toBe('failed');
    expect(await count()).toBe(10);
    for (const status of [500, 503, 409]) {
      sendSpy.mockRejectedValueOnce(new MailerHttpError(status)); // L2/L3: 500 is the boundary, 409 a replay
      const b = await queued('E1');
      expect(await deliverEmail(b, { inline: true })).toBe('failed');
      expect(await logRow(b)).toEqual({ status: 'failed', attempts: 1 });
    }
    expect(await count()).toBe(13);
  });
});

describe('pr31 review M1: a refused slot takes nothing', () => {
  it('at 94 a parked P2 leaves the count alone, so a P1 still sends and the day is not frozen', async () => {
    await setCount(94);
    expect(await deliverEmail(await queued('E1'), { inline: true })).toBe('queued');
    expect(await count()).toBe(94);
    expect(await deliverEmail(await queued('E11'), { inline: true })).toBe('sent');
    expect(await count()).toBe(95);
    expect((await emailLimit()).reached).toBe(false);
    // at 95 the next P1 waits and marks the day full, still without taking a slot
    expect(await deliverEmail(await queued('E11'), { inline: true })).toBe('queued');
    expect(await count()).toBe(95);
    expect((await emailLimit()).reached).toBe(true);
  });
  it('P2/P3 parked at once with P1s from 93: exactly 2 P1s go out, nothing else counts, no freeze', async () => {
    await setCount(93);
    const p1 = await Promise.all(Array.from({ length: 2 }, () => queued('E11')));
    const other = await Promise.all(Array.from({ length: 10 }, (_, i) => queued(i % 2 ? 'E1' : 'E2')));
    const results = await Promise.all([...other, ...p1].map((id) => deliverEmail(id, { inline: true })));
    expect(results.slice(10)).toEqual(['sent', 'sent']);
    expect(results.slice(0, 10).every((r) => r === 'queued')).toBe(true);
    expect(await count()).toBe(95);
    expect((await emailLimit()).reached).toBe(false);
  });
  it('a marked-full day parks even under the ceiling', async () => {
    await setCount(5);
    await q(`update email_budget set limit_hit_at = now()`);
    expect(await deliverEmail(await queued('E11'), { inline: true })).toBe('queued');
    expect(await deliverEmail(await queued('E2'), { inline: true })).toBe('queued'); // not the digest
    expect(await count()).toBe(5);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('pr31 review M2: the next-day claim is one statement', () => {
  async function park(templates: TemplateId[]) {
    await setCount(95);
    const ids: string[] = [];
    for (const t of templates) {
      const id = await queued(t);
      await deliverEmail(id, { inline: true, now: new Date('2027-03-01T18:00:00Z') });
      ids.push(id);
    }
    await newUtcDay();
    return ids;
  }
  const tomorrow = new Date('2027-03-02T00:10:00Z');

  it('a claim re-arms its email_log row in the same statement; two runners claim disjoint rows', async () => {
    const ids = await park(['E1', 'E1', 'E1', 'E1', 'E1', 'E1']);
    const runner = async () => {
      const mine: string[] = [];
      for (let c = await claimQueued(tomorrow); c; c = await claimQueued(tomorrow)) mine.push(c.id);
      return mine;
    };
    const [a, b] = await Promise.all([runner(), runner()]);
    expect([...a, ...b].sort()).toEqual([...ids].sort());
    expect(a.filter((id) => b.includes(id))).toEqual([]);
    // no send happened, yet no row is stranded: each is 'pending' and due for email-retry
    const rows = await q<{ status: string; due: boolean }>(
      `select status::text, next_attempt_at <= $1 as due from email_log`,
      [tomorrow],
    );
    expect(rows.every((r) => r.status === 'pending' && r.due)).toBe(true);
    expect(await q('select 1 from email_queue where sent_at is null')).toHaveLength(0);
  });
  it('a row locked by another runner is skipped, not waited on', async () => {
    const [first, second] = await park(['E1', 'E1']);
    const other = await pool().connect();
    try {
      await other.query('begin');
      await other.query('select 1 from email_queue where email_log_id = $1 for update', [first]);
      const claim = await Promise.race([
        claimQueued(tomorrow),
        new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 2000)),
      ]);
      expect(claim).toEqual({ id: second, priority: 2, armed: true });
    } finally {
      await other.query('rollback');
      other.release();
    }
  });
  it('a claimed row that is no longer queued is left to its owner; the drain goes on', async () => {
    const [gone, next] = await park(['E1', 'E1']);
    // e.g. a row that failed elsewhere: email-retry owns it, the drain must not deliver it
    await q(
      `update email_log set status = 'failed', next_attempt_at = now() - interval '1 hour' where id = $1`,
      [gone],
    );
    expect(await sendQueuedEmails(tomorrow, FAR)).toBe(1);
    expect(sendSpy.mock.calls.map((c) => c[0].idempotencyKey)).toEqual([next]);
  });
});

describe('pr31 review M3: a render failure is terminal', () => {
  it('an E4 missing {dish} fails for good: no slot, no send, no retry, no Resend', async () => {
    await setCount(10);
    const id = await queued('E4', { day: 'Mon', when: 'Mon', manageLink: 'x', dish: '' });
    await q(`update email_log set vars = vars - 'dish' where id = $1`, [id]);
    expect(await deliverEmail(id, { inline: true })).toBe('failed');
    expect(await count()).toBe(10);
    expect(sendSpy).not.toHaveBeenCalled();
    const [row] = await q<{ status: string; attempts: number; last_error: string }>(
      'select status::text, attempts, last_error from email_log where id = $1',
      [id],
    );
    expect(row).toEqual({ status: 'failed', attempts: MAX_ATTEMPTS, last_error: 'UnfilledPlaceholderError' });
    await q(`update email_log set next_attempt_at = now() - interval '1 hour'`);
    expect(await retryDueEmails(new Date(Date.now() + 86_400_000), FAR)).toBe(0);
    expect(await resendFailedEmail(id)).toBe('not_found');
    expect((await failedEmails()).map((f) => [f.id, f.resendable])).toEqual([[id, false]]);
    expect(await logRow(id)).toEqual({ status: 'failed', attempts: MAX_ATTEMPTS });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('pr40 recipe: an unknown link spec (UnknownLinkKindError) is terminal the same way, before any slot', async () => {
    await setCount(10);
    const id = await queued('E4', { day: 'Mon', when: 'Mon', dish: 'x' });
    await q(
      `update email_log set vars = vars || '{"manageLink": {"link": "bogus", "requestId": "x"}}'::jsonb where id = $1`,
      [id],
    );
    expect(await deliverEmail(id, { inline: true })).toBe('failed');
    expect(await count()).toBe(10); // no slot taken
    expect(sendSpy).not.toHaveBeenCalled();
    expect(await logRow(id)).toEqual({ status: 'failed', attempts: MAX_ATTEMPTS });
    expect(await resendFailedEmail(id)).toBe('not_found');
    expect((await failedEmails()).find((f) => f.id === id)?.resendable).toBe(false);
  });
  it('a render failure never parks or blocks the next email in the batch', async () => {
    await setCount(94);
    const bad = await queued('E4', { day: 'Mon', when: 'Mon', manageLink: 'x' });
    await q(`update email_log set vars = vars - 'when' where id = $1`, [bad]);
    const good = await queued('E11');
    expect(await deliverEmail(bad, { inline: true })).toBe('failed');
    expect(await deliverEmail(good, { inline: true })).toBe('sent');
    expect(await count()).toBe(95);
    expect(await q('select 1 from email_queue')).toHaveLength(0);
  });
});

describe('AC2: exactly one email per action', () => {
  it('two concurrent deliveries of one row send once; a replay sends nothing', async () => {
    const id = await queued('E1');
    const r = await Promise.all([deliverEmail(id, { inline: true }), deliverEmail(id, { inline: true })]);
    expect(r.sort()).toEqual(['sent', 'skipped']);
    expect(await deliverRequestEmails('00000000-0000-4000-8000-000000000000')).toEqual([]);
    expect(await deliverEmail(id, { inline: true })).toBe('skipped');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await q('select 1 from dev_outbox')).toHaveLength(1);
    expect(await q(`select 1 from email_log`)).toHaveLength(1);
  });
});

describe('the admin APIs (T3.2.07, T3.2.08)', () => {
  const post = (id: string, origin = SITE) =>
    resendRoute(
      new NextRequest(`${SITE}/api/admin/email/${id}/resend`, { method: 'POST', headers: { origin } }),
      {
        params: Promise.resolve({ id }),
      },
    );

  it('GET lists failed sends and the banner; Resend re-sends a failed row once as P1', async () => {
    sendSpy.mockRejectedValueOnce(new MailerHttpError(500));
    const id = await queued('E1');
    expect(await deliverEmail(id, { inline: true })).toBe('failed');
    const res = await getEmailStatus(new NextRequest(`${SITE}/api/admin/email`));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const body = await res.json();
    expect(body.limit.reached).toBe(false);
    expect(body.budgetHitTwoDaysRunning).toBe(false);
    expect(body.bouncePolling).toEqual({ disabled: false });
    expect(body.failed).toEqual([
      expect.objectContaining({ id, template: 'E1', requestId: null, lastError: 'MailerHttpError' }),
    ]);

    await setCount(90); // P2 would wait at 85, but a manual Resend is P1
    const ok = await post(id);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, result: 'sent' });
    expect((await post(id)).status).toBe(404); // no longer failed
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('Resend: a bad id or an unknown id is 404; a foreign Origin is 403; no session is 401', async () => {
    expect((await post('not-a-uuid')).status).toBe(404);
    expect((await post('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await post('00000000-0000-4000-8000-000000000000', 'https://evil.example')).status).toBe(403);
    vi.mocked(currentAuthEmail).mockResolvedValue(null);
    expect((await post('00000000-0000-4000-8000-000000000000')).status).toBe(401);
    expect((await getEmailStatus(new NextRequest(`${SITE}/api/admin/email`))).status).toBe(401);
  });

  it('"hit two days running": yesterday plus today or the day before', async () => {
    const now = new Date();
    const day = (b: number) => new Date(now.getTime() - b * 86_400_000).toISOString().slice(0, 10);
    const put = (d: string, sent: number, hit = false) =>
      q(
        `insert into email_budget (utc_day, sent_count, limit_hit_at) values ($1::date, $2, $3)
         on conflict (utc_day) do update set sent_count = $2, limit_hit_at = $3`,
        [d, sent, hit ? now : null],
      );
    await put(day(1), 85);
    expect(await budgetHitTwoDaysRunning(now)).toBe(false);
    await put(day(0), 3, true);
    expect(await budgetHitTwoDaysRunning(now)).toBe(true);
    await put(day(0), 3);
    await put(day(2), 90);
    expect(await budgetHitTwoDaysRunning(now)).toBe(true);
    await put(day(1), 84);
    expect(await budgetHitTwoDaysRunning(now)).toBe(false);
  });
});

describe('pr36 review: permanent mailer errors (F3, F8) and the limits per mailer (F5)', () => {
  const useMode = async (mode: 'resend' | 'gmail_api') => {
    await q(
      `insert into system_status (key, value) values ('mailer_mode', $1)
       on conflict (key) do update set value = excluded.value`,
      [mode],
    );
    resetMailerModeCache();
  };
  afterAll(async () => {
    await q(`delete from system_status where key = 'mailer_mode'`);
    resetMailerModeCache();
  });

  it('F3: a token Gmail refuses fails on the first try, refunds the slot, is never retried, and stays resendable', async () => {
    await setCount(10);
    sendSpy.mockRejectedValueOnce(new MailerNotConfiguredError('gmail auth'));
    const id = await queued('E1');
    expect(await deliverEmail(id, { inline: true })).toBe('failed');
    expect(await count()).toBe(10);
    expect(await logRow(id)).toEqual({ status: 'failed', attempts: MAX_ATTEMPTS });
    expect(await retryDueEmails(new Date(Date.now() + 86_400_000), FAR)).toBe(0);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect((await failedEmails()).find((f) => f.id === id)?.resendable).toBe(true);
    expect(await resendFailedEmail(id)).toBe('sent'); // fixed: the Resend action sends it
  });

  it('F8: a message that can never be built is failed for good and cannot be re-sent', async () => {
    await setCount(10);
    sendSpy.mockRejectedValueOnce(new MailerInvalidMessageError('bad address'));
    const id = await queued('E1');
    expect(await deliverEmail(id, { inline: true })).toBe('failed');
    expect(await count()).toBe(10);
    expect(await logRow(id)).toEqual({ status: 'failed', attempts: MAX_ATTEMPTS });
    expect((await failedEmails()).find((f) => f.id === id)?.resendable).toBe(false);
    expect(await resendFailedEmail(id)).toBe('not_found');
  });

  it("F5: gmail_api uses Gmail's limits (digest 280, P2/P3 stop 360, P1 to 400); resend keeps 60/85/95", async () => {
    const now = new Date();
    await useMode('gmail_api');
    await setCount(85);
    expect(await deliverEmail(await queued('E1'), { inline: true, now })).toBe('sent'); // over Resend's 85
    await setCount(279);
    expect(await deliverEmail(await queued('E2'), { inline: true, now })).toBe('sent');
    await setCount(280);
    expect(await deliverEmail(await queued('E2'), { inline: true, now })).toBe('digested');
    await setCount(359);
    expect(await deliverEmail(await queued('E1'), { inline: true, now })).toBe('sent');
    await setCount(360);
    expect(await deliverEmail(await queued('E1'), { inline: true, now })).toBe('queued');
    await setCount(399);
    expect(
      await deliverEmail(await queued('E4', { day: 'Mon', when: 'Mon', manageLink: 'x' }), {
        inline: true,
        now,
      }),
    ).toBe('sent');
    await setCount(400);
    expect(
      await deliverEmail(await queued('E4', { day: 'Mon', when: 'Mon', manageLink: 'x' }), {
        inline: true,
        now,
      }),
    ).toBe('queued');

    await useMode('resend');
    await setCount(85);
    expect(await deliverEmail(await queued('E1'), { inline: true, now })).toBe('queued');
    await setCount(94);
    expect(
      await deliverEmail(await queued('E4', { day: 'Mon', when: 'Mon', manageLink: 'x' }), {
        inline: true,
        now,
      }),
    ).toBe('sent');
  });

  it("F5: 'budget hit' uses the current mailer's budget", async () => {
    const now = new Date();
    const day = (back: number) => new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    for (const back of [0, 1])
      await q(`insert into email_budget (utc_day, sent_count) values ($1::date, 100)`, [day(back)]);
    await useMode('resend');
    expect(await budgetHitTwoDaysRunning(now)).toBe(true);
    await useMode('gmail_api');
    expect(await budgetHitTwoDaysRunning(now)).toBe(false); // 100 is well under Gmail's 360
    await q(`update email_budget set sent_count = 360`);
    expect(await budgetHitTwoDaysRunning(now)).toBe(true);
  });
});
