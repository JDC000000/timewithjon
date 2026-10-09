// QA4 M3: guest Sends per IP are 30 in any 60 minutes (sliding, 5-minute buckets), and a refused try gives its count
// back. Both halves must hold: a flood from one IP is still capped, and a party of 15 guests on one wifi, each with a
// retry, all get through. Against the real limiter SQL on the loopback test DB.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { check, LIMITS } from '@/lib/ratelimit';
import { pool, q } from '@/lib/db';

const counted = async (ip: string) =>
  (
    await q<{ n: number }>(
      `select coalesce(sum(count), 0)::int as n from rate_limit where scope = 'requestSend' and key = $1`,
      [ip],
    )
  )[0]!.n;
const sends = async (ip: string, n: number) => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(await check('requestSend', ip));
  return out;
};
let ip = '';
beforeEach(() => {
  ip = `test-${randomUUID()}`;
});
afterAll(async () => {
  await q(`delete from rate_limit where scope = 'requestSend' and key like 'test-%'`);
  await pool().end();
});

describe('guest Send limit per IP (QA4 M3)', () => {
  it('is 30 an hour, sliding', () => {
    expect(LIMITS.requestSend).toEqual({ limit: 30, windowSec: 3600, bucketSec: 300 });
  });

  it('15 honest guests on one IP, each with a retry, all get through', async () => {
    expect(await sends(ip, 30)).toEqual(Array(30).fill('allowed'));
  });

  it('a flood from one IP is still capped, and its refused tries never count (the block never grows)', async () => {
    const out = await sends(ip, 80);
    expect(out.filter((v) => v === 'allowed')).toHaveLength(30);
    expect(out.slice(30)).toEqual(Array(50).fill('limited'));
    expect(await counted(ip)).toBe(30);
  });

  it('a flood at the same moment never gets past the limit', async () => {
    const out = await Promise.all(Array.from({ length: 60 }, () => check('requestSend', ip)));
    expect(out.filter((v) => v === 'allowed').length).toBeLessThanOrEqual(30);
    expect(await counted(ip)).toBeLessThanOrEqual(30);
  });

  it('the window slides: half an hour later still full, an hour later open again (not at the top of the hour)', async () => {
    await sends(ip, 31);
    const age = (min: number) =>
      q(
        `update rate_limit set window_start = window_start - make_interval(mins => $2)
          where scope = 'requestSend' and key = $1`,
        [ip, min],
      );
    await age(30);
    expect(await check('requestSend', ip)).toBe('limited');
    await age(31); // the 30 now started over an hour ago
    expect(await check('requestSend', ip)).toBe('allowed');
  });
});
