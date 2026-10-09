// T3.8 AC3 + AC4: over the limit from one IP gets the friendly 429; a limiter error fails OPEN and reports.
// QA4 M3: guest Sends are 30 in a sliding hour and a refused try gives its count back (the real SQL: the int test).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SITE } from '../../../tests/fixtures/unit-env';
import { ERRORS } from '@/content';

const db = vi.hoisted(() => ({ counts: new Map<string, number>(), fail: false, failGiveBack: false }));
vi.mock('@/lib/db', () => ({
  q: vi.fn(async (sql: string, [scope, key]: [string, string]) => {
    if (db.fail) throw new Error('connection refused');
    const k = `${scope}|${key}`;
    if (sql.trim().startsWith('update rate_limit set count = count - 1')) {
      if (db.failGiveBack) throw new Error('connection reset');
      db.counts.set(k, db.counts.get(k)! - 1); // a refused sliding try gives its count back
      return [];
    }
    if (sql.includes('with mine as')) {
      db.counts.set(k, (db.counts.get(k) ?? 0) + 1);
      return [{ bucket: new Date(0), total: db.counts.get(k) }];
    }
    if (sql.trim().startsWith('select')) return db.counts.has(k) ? [{ count: db.counts.get(k) }] : [];
    db.counts.set(k, (db.counts.get(k) ?? 0) + 1);
    return [{ count: db.counts.get(k) }];
  }),
}));
const report = vi.hoisted(() => vi.fn());
vi.mock('@/lib/report', () => ({ report, reportMessage: vi.fn() }));

const { check, hit, limitByIp, overLimitByIp, FAIL_CLOSED, LIMITS } = await import('@/lib/ratelimit');
const post = () => new NextRequest(`${SITE}/api/requests`, { method: 'POST', headers: { origin: SITE } });

beforeEach(() => {
  db.counts.clear();
  db.fail = false;
  db.failGiveBack = false;
  report.mockClear();
});

describe('limitByIp (T3.8.02)', () => {
  it('allows 30 request sends in a sliding hour, then answers the friendly 429 (AC3, QA4 M3)', async () => {
    expect(LIMITS.requestSend).toEqual({ limit: 30, windowSec: 3600, bucketSec: 300 });
    for (let i = 1; i <= 30; i++) expect(await limitByIp(post(), 'requestSend'), `send ${i}`).toBeNull();
    const res = await limitByIp(post(), 'requestSend');
    expect(res?.status).toBe(429);
    expect(await res?.json()).toEqual({ ok: false, code: 'rate_limited', message: ERRORS.rateLimited });
    // QA4 M3: the refused tries never count, so the block doesn't grow with each retry.
    for (let i = 0; i < 5; i++) await limitByIp(post(), 'requestSend');
    expect([...db.counts.values()]).toEqual([30]);
  });

  it('a refused sliding try stays refused when giving its count back fails (never let through by the error)', async () => {
    for (let i = 0; i < 30; i++) await limitByIp(post(), 'requestSend');
    db.failGiveBack = true;
    expect((await limitByIp(post(), 'requestSend'))?.status).toBe(429);
    expect(report).toHaveBeenCalledWith(expect.any(Error), {
      area: 'ratelimit',
      scope: 'requestSend',
      step: 'give_back',
    });
  });

  it('keeps separate buckets per scope', async () => {
    for (let i = 0; i < 30; i++) await limitByIp(post(), 'requestSend');
    expect(await limitByIp(post(), 'storySave')).toBeNull();
  });

  it('every guarded scope has a positive limit and window', () => {
    for (const s of ['storySave', 'photoSign', 'offerTake', 'manageAction'] as const) {
      expect(LIMITS[s].limit).toBeGreaterThan(0);
      expect(LIMITS[s].windowSec).toBe(3600);
    }
  });
});

describe('hit fails open (AC4)', () => {
  it('a limiter error allows the call and reports it', async () => {
    db.fail = true;
    expect(await hit('requestSend', '1.2.3.4')).toBe(true);
    expect(await limitByIp(post(), 'requestSend')).toBeNull();
    expect(report).toHaveBeenCalledWith(expect.any(Error), { area: 'ratelimit', scope: 'requestSend' });
  });

  it('allows exactly the limit, not one more', async () => {
    for (let i = 0; i < LIMITS.photoSign.limit; i++) expect(await hit('photoSign', 'k')).toBe(true);
    expect(await hit('photoSign', 'k')).toBe(false);
  });
});

describe('auth scopes fail CLOSED (security review 2026-09-30, C1)', () => {
  const AUTH = ['adminSignInStart', 'adminSignInVerify', 'adminSignInVerifyEmail', 'devLogin'] as const;

  it('covers every sign-in and guessing scope', () => {
    expect([...FAIL_CLOSED].sort()).toEqual([...AUTH].sort());
  });

  it('a limiter error refuses the call, says "unavailable" and reports it', async () => {
    db.fail = true;
    for (const scope of AUTH) {
      expect(await hit(scope, '1.2.3.4'), scope).toBe(false);
      expect(await check(scope, '1.2.3.4'), scope).toBe('unavailable');
      expect(report).toHaveBeenCalledWith(expect.any(Error), {
        area: 'ratelimit',
        scope,
        mode: 'fail_closed',
      });
    }
  });

  it('with a healthy limiter they count like any other scope', async () => {
    const { limit } = LIMITS.adminSignInVerify;
    for (let i = 0; i < limit; i++) expect(await check('adminSignInVerify', 'ip')).toBe('allowed');
    expect(await check('adminSignInVerify', 'ip')).toBe('limited');
  });

  it('guest scopes still fail open', async () => {
    db.fail = true;
    expect(await check('requestSend', '1.2.3.4')).toBe('allowed');
  });
});

describe('overLimitByIp (success-only limits, photoFinalise)', () => {
  it('reads without counting, and refuses once the successes reach the limit', async () => {
    for (let i = 0; i < 5; i++) expect(await overLimitByIp(post(), 'photoFinalise')).toBeNull();
    for (let i = 0; i < LIMITS.photoFinalise.limit - 1; i++) await hit('photoFinalise', 'local');
    expect(await overLimitByIp(post(), 'photoFinalise')).toBeNull();
    await hit('photoFinalise', 'local');
    const res = await overLimitByIp(post(), 'photoFinalise');
    expect(res?.status).toBe(429);
    expect(await res?.json()).toEqual({ ok: false, code: 'rate_limited', message: ERRORS.rateLimited });
  });
  it('fails open and reports', async () => {
    db.fail = true;
    expect(await overLimitByIp(post(), 'photoFinalise')).toBeNull();
    expect(report).toHaveBeenCalledWith(expect.any(Error), { area: 'ratelimit', scope: 'photoFinalise' });
  });
});
