// T3.14.01 (TSD T3.14 AC4, AC5; tasks.md review V3): /api/health's checks against the test DB. A fixed future
// `now` keeps the email budget days empty; other files' open outbox rows are parked past it and restored after.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const failDb = vi.hoisted(() => ({ next: false }));
vi.mock('@/lib/db', async (orig) => {
  const real = await orig<typeof import('@/lib/db')>();
  return {
    ...real,
    q: (...args: Parameters<typeof real.q>) => {
      if (failDb.next) {
        failDb.next = false;
        return Promise.reject(new Error('connect ECONNREFUSED'));
      }
      return real.q(...args);
    },
  };
});

vi.mock('@/lib/report', async (orig) => {
  const real = await orig<typeof import('@/lib/report')>();
  return { ...real, report: vi.fn() };
});

import { NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { report } from '@/lib/report';
import { GET as getHealth } from '@/app/api/health/route';
import {
  cachedHealthReport,
  givenUpLine,
  HEALTH_CACHE_MS,
  HEALTH_LIMITS,
  healthReport,
  notDeliveredLine,
  publicHealthBody,
  resetHealthCacheForTests,
} from '@/features/jobs/health';
import { TICK_FAILED_KEY } from '@/features/jobs/registry';
import { SIGNIN_FAILED_KEY } from '@/features/admin/signin';
import { SEED_INVITE_SECRETS } from '@/features/invites/seed-invites';
import { cancelMade, newRequest } from '../fixtures/requests-db';

const NOW = new Date('2031-03-12T20:00:00Z');
const MIN = 60_000;
const ago = (ms: number, from = NOW) => new Date(from.getTime() - ms);
const KEYS = ['last_tick_at', 'last_media_run_at', SIGNIN_FAILED_KEY, TICK_FAILED_KEY];
const GET = (headers: Record<string, string> = {}) =>
  getHealth(new NextRequest('http://localhost:3000/api/health', { headers }));
const WITH_SECRET = { 'x-cron-secret': 'c'.repeat(32) }; // tests/setup-int.ts
let parked: { id: string; next_attempt_at: Date }[] = [];
let savedStatus: { key: string; value: string | null; updated_at: Date }[] = [];
let savedOauth: Record<string, unknown>[] = [];
const myOutbox: string[] = [];
const myEmails: string[] = [];
let requestId = '';
const WITH_REQUEST = ['calendar_create', 'calendar_patch', 'calendar_delete', 'ics'];

async function beat(key: string, at: Date, value: string | null = at.toISOString()) {
  await q(
    `insert into system_status (key, value, updated_at) values ($1, $2, $3)
       on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, at],
  );
}
async function healthy(at = NOW) {
  await beat('last_tick_at', ago(1 * MIN, at));
  await beat('last_media_run_at', ago(1 * MIN, at));
}
/** Calendar (and ics) rows get a request (the processor only takes those) unless `noRequest`. */
async function outboxRow(kind: string, nextAttemptAt: Date, attempts = 0, done = false, noRequest = false) {
  const [r] = await q<{ id: string }>(
    `insert into outbox (kind, payload, attempts, next_attempt_at, done_at, request_id)
       values ($1::outbox_kind, '{}', $2, $3, $4, $5) returning id`,
    [
      kind,
      attempts,
      nextAttemptAt,
      done ? NOW : null,
      WITH_REQUEST.includes(kind) && !noRequest ? requestId : null,
    ],
  );
  myOutbox.push(r!.id);
}
async function google(
  lastOkAt: Date | null,
  lastError: string | null = null,
  token: string | null = '\\x00',
) {
  await q(
    `insert into oauth_connection (provider, account_email, refresh_token_enc, scopes, last_ok_at, last_error)
       values ('google', 'jon@example.com', $3::bytea, '{openid}', $1, $2)`,
    [lastOkAt, lastError, token],
  );
}
const countGivenUp = async () =>
  (
    await q<{ n: number }>(
      `select count(*)::int as n from outbox
        where done_at is null and kind in ('r2_copy', 'attachment_finalise') and attempts >= 8`,
    )
  )[0]!.n;
async function failedEmail(attempts: number) {
  const [r] = await q<{ id: string }>(
    `insert into email_log (template, to_email, event_key, status, attempts, last_error)
       values ('E14', 'jon@example.com', $1, 'failed', $2, 'ResendError') returning id`,
    [`health-test:${randomUUID()}`, attempts],
  );
  myEmails.push(r!.id);
}

beforeAll(async () => {
  requestId = await newRequest({ name: 'Health Outbox' });
  savedStatus = await q(`select key, value, updated_at from system_status where key = any($1)`, [KEYS]);
  savedOauth = await q(`select * from oauth_connection`);
  parked = await q(`select id, next_attempt_at from outbox where done_at is null`);
  await q(`update outbox set next_attempt_at = '2100-01-01' where id = any($1::uuid[])`, [
    parked.map((p) => p.id),
  ]);
});
beforeEach(async () => {
  resetHealthCacheForTests();
  vi.mocked(report).mockClear();
  await q(`delete from system_status where key = any($1)`, [KEYS]);
  await q(`delete from oauth_connection`);
});
afterEach(async () => {
  failDb.next = false;
  await q(`delete from outbox where id = any($1::uuid[])`, [myOutbox.splice(0)]);
  await q(`delete from email_log where id = any($1::uuid[])`, [myEmails.splice(0)]);
  await q(`delete from email_budget where utc_day >= '2031-01-01'`);
});
afterAll(async () => {
  await q(`delete from system_status where key = any($1)`, [KEYS]);
  for (const s of savedStatus) await beat(s.key, s.updated_at, s.value);
  await q(`delete from oauth_connection`);
  for (const o of savedOauth) {
    const cols = Object.keys(o);
    await q(
      `insert into oauth_connection (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      cols.map((c) => o[c]),
    );
  }
  await cancelMade();
  for (const p of parked)
    await q(`update outbox set next_attempt_at = $2 where id = $1`, [p.id, p.next_attempt_at]);
});

describe('healthReport (T3.14.01)', () => {
  it('a healthy system with no Google row yet is ok, google skipped (AC4, AC5)', async () => {
    await healthy();
    const r = await healthReport(NOW);
    expect(r).toEqual({
      ok: true,
      checks: {
        database: 'ok',
        tick: 'ok',
        outbox: 'ok',
        google: 'skipped',
        media: 'ok',
        signin_email: 'ok',
        seed_invites: 'skipped',
      },
      failing: [],
      // other files' abandoned emails and given-up media rows
      warnings: r.warnings.filter((w) => w.startsWith('failed_emails: ') || w.startsWith('outbox: ')),
    });
  });

  it('a tick where every job failed fails tick as jobs_failing; some failed is a warning', async () => {
    await healthy();
    await beat(TICK_FAILED_KEY, ago(1 * MIN), '13/13');
    const all = await healthReport(NOW);
    expect(all.checks.tick).toBe('jobs_failing');
    expect(all.failing).toContain('tick');
    resetHealthCacheForTests();
    await beat(TICK_FAILED_KEY, ago(1 * MIN), '2/13');
    const some = await healthReport(NOW);
    expect(some.checks.tick).toBe('ok');
    expect(some.warnings).toContain('tick: 2 of 13 jobs failed');
    await beat(TICK_FAILED_KEY, ago(1 * MIN), '0/13');
    const none = await healthReport(NOW);
    expect(none.checks.tick).toBe('ok');
    expect(none.warnings.some((w) => w.startsWith('tick: '))).toBe(false);
    await beat(TICK_FAILED_KEY, ago(1 * MIN), '0/0'); // every job skipped: not a failure
    expect((await healthReport(NOW)).checks.tick).toBe('ok');
    // One job ran (it hit the hard stop, the rest were skipped) and failed: a warning, not a red check.
    await beat(TICK_FAILED_KEY, ago(1 * MIN), '1/1');
    const one = await healthReport(NOW);
    expect(one.checks.tick).toBe('ok');
    expect(one.warnings).toContain('tick: 1 of 1 jobs failed');
    // Two that ran and both failed: red.
    await beat(TICK_FAILED_KEY, ago(1 * MIN), '2/2');
    expect((await healthReport(NOW)).checks.tick).toBe('jobs_failing');
  });

  it('the tick heartbeat: missing or 35 min old fails, 34 min passes', async () => {
    await beat('last_media_run_at', NOW);
    expect((await healthReport(NOW)).checks.tick).toBe('missing');
    await beat('last_tick_at', ago(HEALTH_LIMITS.tickMs - MIN));
    expect((await healthReport(NOW)).ok).toBe(true);
    await beat('last_tick_at', ago(HEALTH_LIMITS.tickMs));
    const r = await healthReport(NOW);
    expect(r).toMatchObject({ ok: false, failing: ['tick'] });
    expect(r.checks.tick).toBe('stale');
  });

  it('the media heartbeat: missing or 20 min old fails, 19 min passes', async () => {
    await beat('last_tick_at', NOW);
    expect(await healthReport(NOW)).toMatchObject({ failing: ['media'], checks: { media: 'missing' } });
    await beat('last_media_run_at', ago(19 * MIN));
    expect((await healthReport(NOW)).ok).toBe(true);
    await beat('last_media_run_at', ago(20 * MIN));
    expect(await healthReport(NOW)).toMatchObject({ failing: ['media'], checks: { media: 'stale' } });
  });

  it('the outbox: the oldest DUE row 60 min overdue fails; done, future and out-of-tries rows never do', async () => {
    await healthy();
    await outboxRow('calendar_create', ago(59 * MIN));
    await outboxRow('calendar_patch', ago(5 * 60 * MIN), 4); // out of tries (4): the tick hands it on
    await outboxRow('r2_copy', ago(5 * 60 * MIN), 8); // media out of tries (8)
    await outboxRow('calendar_delete', ago(5 * 60 * MIN), 1, true); // done
    await outboxRow('calendar_create', new Date(NOW.getTime() + 60 * MIN)); // not due yet
    expect((await healthReport(NOW)).checks.outbox).toBe('ok');
    await outboxRow('calendar_delete', ago(60 * MIN), 3); // a calendar row with a try left
    expect(await healthReport(NOW)).toMatchObject({
      ok: false,
      failing: ['outbox'],
      checks: { outbox: 'overdue' },
    });
  });

  it('a media row with tries left (under 8) counts as due', async () => {
    await healthy();
    await outboxRow('attachment_finalise', ago(61 * MIN), 7);
    expect((await healthReport(NOW)).failing).toEqual(['outbox']);
  });

  it('pr61 F3: due = what the processors take: no calendar row without a request, no ics row', async () => {
    await healthy();
    await outboxRow('calendar_delete', ago(120 * MIN), 0, false, true); // a spam Delete nulled its request
    await outboxRow('ics', ago(120 * MIN)); // no processor takes 'ics'
    expect((await healthReport(NOW)).checks.outbox).toBe('ok');
    await outboxRow('calendar_patch', ago(120 * MIN), 0); // the same, with a request: due
    expect((await healthReport(NOW)).checks.outbox).toBe('overdue');
  });

  it('pr61 F2: media rows out of tries are a warning line, still 200', async () => {
    await healthy();
    const base = await countGivenUp();
    await outboxRow('r2_copy', ago(5 * 60 * MIN), 8);
    await outboxRow('attachment_finalise', NOW, 7); // tries left: not given up
    await outboxRow('attachment_finalise', ago(5 * 60 * MIN), 8, true); // done: not given up
    const r = await healthReport(NOW);
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain(`outbox: ${givenUpLine(base + 1)}`);
    expect(givenUpLine(1)).toBe('1 item given up');
    expect(givenUpLine(2)).toBe('2 items given up');
  });

  it('pr61 F1: a Disconnected row (no token) fails as disconnected, whatever last_ok_at says', async () => {
    await healthy();
    await google(NOW, 'disconnected', null);
    expect(await healthReport(NOW)).toMatchObject({
      ok: false,
      failing: ['google'],
      checks: { google: 'disconnected' },
    });
  });

  it('Google: last_ok_at under 26 h passes; older or never fails; a dead grant is "broken" at once', async () => {
    await healthy();
    await google(ago(HEALTH_LIMITS.googleOkMs - MIN), 'http_503'); // a transient error heals: not broken
    expect((await healthReport(NOW)).checks.google).toBe('ok');
    await q(`update oauth_connection set last_ok_at = $1`, [ago(HEALTH_LIMITS.googleOkMs)]);
    expect(await healthReport(NOW)).toMatchObject({
      ok: false,
      failing: ['google'],
      checks: { google: 'stale' },
    });
    await q(`update oauth_connection set last_ok_at = null`);
    expect((await healthReport(NOW)).checks.google).toBe('missing');
    await q(`update oauth_connection set last_ok_at = $1, last_error = 'invalid_grant'`, [NOW]);
    expect(await healthReport(NOW)).toMatchObject({ failing: ['google'], checks: { google: 'broken' } });
  });

  it('signin_email: a flag under 24 h fails with its reason code only; an older one passes', async () => {
    await healthy();
    await beat(SIGNIN_FAILED_KEY, ago(HEALTH_LIMITS.signinEmailMs - MIN), 'smtp');
    expect(await healthReport(NOW)).toMatchObject({
      failing: ['signin_email'],
      checks: { signin_email: 'smtp' },
    });
    await beat(SIGNIN_FAILED_KEY, ago(HEALTH_LIMITS.signinEmailMs), 'quota');
    expect((await healthReport(NOW)).ok).toBe(true);
  });

  it('names every failing check at once', async () => {
    await google(null);
    expect((await healthReport(NOW)).failing).toEqual(['tick', 'google', 'media']);
  });

  it('warnings: abandoned emails are a named line (review V3) and the budget two days running; still 200', async () => {
    await healthy();
    const [{ n: base }] = (await q<{ n: number }>(
      `select count(*)::int as n from email_log where status = 'failed' and attempts >= 4`,
    )) as [{ n: number }];
    await failedEmail(4);
    await failedEmail(2); // still retrying: not abandoned
    await q(
      `insert into email_budget (utc_day, sent_count, limit_hit_at) values ('2031-03-11', 0, $1), ('2031-03-12', 0, $1)`,
      [NOW],
    );
    const r = await healthReport(NOW);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([
      'email_budget: limit hit 2 days running',
      `failed_emails: ${notDeliveredLine(base + 1)}`,
    ]);
  });

  it('the thresholds are the TSD T3.14 ones', () => {
    expect(HEALTH_LIMITS).toEqual({
      tickMs: 35 * MIN,
      outboxOverdueMs: 60 * MIN,
      googleOkMs: 26 * 60 * MIN,
      mediaMs: 20 * MIN,
      signinEmailMs: 24 * 60 * MIN,
    });
  });

  it('notDeliveredLine', () => {
    expect(notDeliveredLine(1)).toBe('1 email not delivered');
    expect(notDeliveredLine(3)).toBe('3 emails not delivered');
  });

  it("pr61 F6: the route's report is cached for 15 s, then checked again", async () => {
    await healthy();
    expect((await cachedHealthReport(NOW)).ok).toBe(true);
    await beat('last_tick_at', ago(HEALTH_LIMITS.tickMs));
    expect((await cachedHealthReport(new Date(NOW.getTime() + HEALTH_CACHE_MS - 1))).ok).toBe(true);
    expect((await cachedHealthReport(new Date(NOW.getTime() + HEALTH_CACHE_MS))).failing).toEqual(['tick']);
    expect(HEALTH_CACHE_MS).toBe(15_000);
  });

  it('the database down: failing database, reported to Sentry (pr61 F4)', async () => {
    failDb.next = true;
    expect(await healthReport(NOW)).toMatchObject({
      ok: false,
      failing: ['database'],
      checks: { database: 'down' },
    });
    expect(report).toHaveBeenCalledWith(expect.any(Error), { area: 'health' });
  });
});

describe('seed invites outside the prototype', () => {
  it('a demo invite from seed.sql fails seed_invites in staging and production, and is reported', async () => {
    await healthy();
    vi.mocked(report).mockClear();
    for (const mode of ['staging', 'production'] as const) {
      const r = await healthReport(NOW, mode);
      expect(r.ok).toBe(false);
      expect(r.failing).toContain('seed_invites');
      expect(r.checks.seed_invites).toBe('present');
    }
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ name: 'SeedInvitePresent' }), {
      area: 'health',
      check: 'seed_invites',
    });
  });

  it('with none of them, seed_invites is ok', async () => {
    await healthy();
    const secrets = [...SEED_INVITE_SECRETS];
    const renamed = await q<{ id: string; token_secret: string }>(
      `select id, token_secret from invite where token_secret = any($1::text[])`,
      [secrets],
    );
    try {
      for (const [i, r] of renamed.entries())
        await q(`update invite set token_secret = $2 where id = $1`, [r.id, `zz${i}zzzzz`]);
      expect((await healthReport(NOW, 'production')).checks.seed_invites).toBe('ok');
    } finally {
      for (const r of renamed)
        await q(`update invite set token_secret = $2 where id = $1`, [r.id, r.token_secret]);
    }
  });
});

describe('GET /api/health', () => {
  it('200 when healthy, 503 naming the check, no-store, and no personal data in the body', async () => {
    const now = new Date();
    await healthy(now);
    await google(now);
    resetHealthCacheForTests();
    const ok = await GET();
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    await beat('last_tick_at', ago(HEALTH_LIMITS.tickMs + MIN, now));
    await beat(SIGNIN_FAILED_KEY, now, 'smtp');
    await failedEmail(4);
    expect((await GET()).status).toBe(200); // the route serves the 15 s cached report (pr61 F6)
    resetHealthCacheForTests();
    const bad = await GET(WITH_SECRET); // which check failed: the cron secret's view
    expect(bad.status).toBe(503);
    const text = await bad.text();
    expect(JSON.parse(text)).toMatchObject({ ok: false, failing: ['tick', 'signin_email'] });
    expect(text).not.toMatch(/@|example\.com|jon/i);
  });

  it('the public body is only {ok} (and the 200/503); the checks, failing names, reasons and warnings need the cron secret', async () => {
    const now = new Date();
    await healthy(now);
    await google(now, 'invalid_grant');
    await failedEmail(4);
    resetHealthCacheForTests();
    const pub = await GET();
    expect(pub.status).toBe(503);
    const body = (await pub.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: false }); // no checks, no failing names
    expect((await (await GET()).json()) as unknown).toEqual({ ok: false });
    const wrong: Record<string, string>[] = [
      { 'x-cron-secret': 'wrong' },
      { authorization: `Bearer ${'c'.repeat(32)}` },
    ];
    for (const headers of wrong) expect(await (await GET(headers)).json()).toEqual(body);
    const full = await GET(WITH_SECRET);
    expect(full.status).toBe(503);
    const detail = (await full.json()) as {
      checks: Record<string, string>;
      failing: string[];
      warnings: string[];
    };
    expect(detail.failing).toEqual(['google']); // the monitoring checks still read every check with the secret
    expect(detail.checks.google).toBe('broken');
    expect(detail.warnings.some((w) => w.startsWith('failed_emails: '))).toBe(true);
    expect(
      publicHealthBody({
        ok: true,
        checks: { ...detail.checks, google: 'skipped' } as never,
        failing: [],
        warnings: ['x'],
      }),
    ).toEqual({ ok: true });
  });

  it('503 database when the DB is down', async () => {
    failDb.next = true;
    const res = await GET(WITH_SECRET);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ failing: ['database'] });
    failDb.next = true;
    resetHealthCacheForTests();
    expect(await (await GET()).json()).toEqual({ ok: false });
  });
});
