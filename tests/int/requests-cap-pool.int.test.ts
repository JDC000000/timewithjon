// CR-02 (full review 2026-10-08): the general invite's daily guest-email cap (requestSendInvite) is counted BEFORE
// the request transaction. Counted inside it, hit() needed a second pool connection while the transaction held one,
// so 3 concurrent general-link Sends on the production pool (3) each waited out the 5 s connection timeout, and
// the limiter failed open: the cap went uncounted. Both halves must hold: the cap still counts every Send, and a
// burst on the 3-connection pool finishes without the limiter failing open.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.hoisted(() => {
  process.env.DB_POOL_MAX = '3'; // the production pool size (DEFAULT_POOL_MAX), whatever the runner sets
});

import { createRequest } from '@/features/requests/create';
import { RequestBody } from '@/features/requests/schema';
import { POOL_CONNECTION_TIMEOUT_MS } from '@/lib/db-config';
import { pool, q } from '@/lib/db';
import { removeRequests } from '../fixtures/requests-db';

const BURST = 5;
const made: string[] = [];
let inviteId = '';
let slot = '';
beforeAll(async () => {
  inviteId = (
    await q<{ id: string }>(`select id from invite where kind = 'general' order by created_at limit 1`)
  )[0]!.id;
  slot = (
    await q<{ id: string }>(`select id from slot where date = '2027-05-13' and window_kind = 'lunch'`)
  )[0]!.id;
  await q(`delete from rate_limit where scope = 'requestSendInvite'`);
});
afterAll(async () => {
  await q(`delete from rate_limit where scope = 'requestSendInvite'`);
  await removeRequests(made);
  await pool().end();
});

const send = async () => {
  const { requestId } = await createRequest({
    body: RequestBody.parse({
      clientKey: randomUUID(),
      dish: 'the-long-lunch',
      name: 'Dave',
      email: `burst+${randomUUID().slice(0, 8)}@example.com`,
      crew: 1,
      slotIds: [slot],
    }),
    inviteId,
    isTest: true,
    spam: false,
    mode: 'slots',
    status: 'requested',
    countsToward: 'weekly_cap',
    bigCrew: false,
    dishName: 'The Long Lunch',
    capGuestEmails: 'general' as const,
  });
  made.push(requestId);
  return requestId;
};
const counted = async () =>
  (
    await q<{ n: number }>(
      `select coalesce(sum(count), 0)::int as n from rate_limit where scope = 'requestSendInvite' and key = $1`,
      [inviteId],
    )
  )[0]!.n;

describe('the general-link guest email cap on the 3-connection pool (CR-02)', () => {
  it(`${BURST} concurrent Sends all finish, each counted once, and the limiter never fails open`, async () => {
    expect(pool().options.max).toBe(3);
    const warn = vi.spyOn(console, 'warn');
    const before = await counted();
    const started = Date.now();
    const ids = await Promise.all(Array.from({ length: BURST }, send));
    const took = Date.now() - started;
    // Deterministic: inside the transaction the limiter timed out and failed open (a warning, nothing counted).
    expect(warn.mock.calls.filter(([line]) => String(line).includes('"area":"ratelimit"'))).toEqual([]);
    expect(await counted()).toBe(before + BURST);
    expect(new Set(ids).size).toBe(BURST);
    // And no Send waited out a pool timeout (before: each one stalled 5 s).
    expect(took).toBeLessThan(POOL_CONNECTION_TIMEOUT_MS);
    for (const id of ids) {
      const t = await q<{ template: string }>(
        `select template from email_log where request_id = $1 order by 1`,
        [id],
      );
      expect(t.map((r) => r.template)).toEqual(['E1', 'E2']);
    }
  }, 60_000);
});
