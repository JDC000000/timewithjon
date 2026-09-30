// T3.8 AC3 + AC4: the 11th request from one IP gets the friendly 429; a limiter error fails OPEN and reports.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SITE } from '../../../tests/fixtures/unit-env';
import { ERRORS } from '@/content';

const db = vi.hoisted(() => ({ counts: new Map<string, number>(), fail: false }));
vi.mock('@/lib/db', () => ({
  q: vi.fn(async (sql: string, [scope, key]: [string, string]) => {
    if (db.fail) throw new Error('connection refused');
    const k = `${scope}|${key}`;
    if (sql.trim().startsWith('select')) return db.counts.has(k) ? [{ count: db.counts.get(k) }] : [];
    db.counts.set(k, (db.counts.get(k) ?? 0) + 1);
    return [{ count: db.counts.get(k) }];
  }),
}));
const report = vi.hoisted(() => vi.fn());
vi.mock('@/lib/report', () => ({ report, reportMessage: vi.fn() }));

const { hit, limitByIp, overLimitByIp, LIMITS } = await import('@/lib/ratelimit');
const post = () => new NextRequest(`${SITE}/api/requests`, { method: 'POST', headers: { origin: SITE } });

beforeEach(() => {
  db.counts.clear();
  db.fail = false;
  report.mockClear();
});

describe('limitByIp (T3.8.02)', () => {
  it('allows 10 request sends an hour, then answers the friendly 429 (AC3)', async () => {
    expect(LIMITS.requestSend).toEqual({ limit: 10, windowSec: 3600 });
    for (let i = 1; i <= 10; i++) expect(await limitByIp(post(), 'requestSend'), `send ${i}`).toBeNull();
    const res = await limitByIp(post(), 'requestSend');
    expect(res?.status).toBe(429);
    expect(await res?.json()).toEqual({ ok: false, code: 'rate_limited', message: ERRORS.rateLimited });
  });

  it('keeps separate buckets per scope', async () => {
    for (let i = 0; i < 10; i++) await limitByIp(post(), 'requestSend');
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
