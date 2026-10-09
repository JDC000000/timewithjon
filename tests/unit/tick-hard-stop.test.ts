// T3.9.01 (AD-8): a hung Google or mailer call inside a tick job is cut off at the hard stop (budget + 1 s),
// so runTick returns inside the route's maxDuration, writes the heartbeat with the failed count, and the jobs the
// budget skipped run first on the next tick.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../fixtures/unit-env';

const db = vi.hoisted(() => ({ status: new Map<string, string>(), writes: 0 }));
vi.mock('@/lib/db', () => ({
  q: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith('select key, value from system_status')) {
      return (params[0] as string[]).flatMap((key) =>
        db.status.has(key) ? [{ key, value: db.status.get(key)! }] : [],
      );
    }
    if (sql.includes('insert into system_status')) {
      db.writes++;
      db.status.set('last_tick_at', params[0] as string);
      for (let i = 1; i < params.length; i += 2) db.status.set(params[i] as string, params[i + 1] as string);
      return [];
    }
    throw new Error(`unexpected query: ${sql}`);
  }),
}));
vi.mock('@/lib/report', () => ({ report: vi.fn(), reportMessage: vi.fn(), errorName: () => 'Error' }));

import { googleFetch } from '@/lib/adapters/google/http';
import { createGmailApiMailer } from '@/lib/adapters/gmail/mailer';
import { createResendMailer } from '@/lib/adapters/resend/mailer';
import {
  registerJob,
  runTick,
  TICK_FAILED_KEY,
  TICK_HARD_STOP_GRACE_MS,
  TICK_SKIPPED_KEY,
} from '@/features/jobs/registry';

/** A fetch that never answers; it only rejects when its signal aborts (a hung socket). */
const hungFetch = vi.fn(
  (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    }),
);

const EMAIL = {
  template: 'E1' as const,
  to: 'guest@example.com',
  from: 'a@example.com',
  replyTo: 'b@example.com',
  subject: 's',
  text: 't',
  idempotencyKey: 'k',
};

const mode = { hang: 'google' as 'google' | 'resend' | 'gmail' | 'none' };
const ranLater: string[] = [];
registerJob({
  name: 'hangs',
  async run() {
    if (mode.hang === 'google') await googleFetch('https://www.googleapis.com/x', { op: 'probe' });
    if (mode.hang === 'resend')
      await createResendMailer({ apiKey: 'k', fetch: hungFetch, sleep: async () => {} }).send(EMAIL);
    if (mode.hang === 'gmail')
      await createGmailApiMailer({ getAccessToken: async () => 't', fetch: hungFetch }).send(EMAIL);
  },
});
registerJob({
  name: 'later',
  async run() {
    ranLater.push('later');
  },
});

const BUDGET_MS = 200;
const LIMIT_MS = BUDGET_MS + TICK_HARD_STOP_GRACE_MS + 500;

beforeEach(() => {
  db.status.clear();
  db.writes = 0;
  ranLater.length = 0;
  vi.stubGlobal('fetch', hungFetch);
});

describe('runTick hard stop', () => {
  it.each(['google', 'resend', 'gmail'] as const)(
    'a hung %s call is cut off: runTick returns in time and writes the heartbeat',
    async (hang) => {
      mode.hang = hang;
      const started = Date.now();
      const result = await runTick(new Date(), BUDGET_MS);
      expect(Date.now() - started).toBeLessThan(LIMIT_MS);
      expect(result.failed).toEqual(['hangs']);
      expect(result.skipped).toEqual(['later']); // the budget was used up by the hung call
      expect(db.writes).toBe(1);
      expect(db.status.get('last_tick_at')).toBeTruthy();
      expect(db.status.get(TICK_FAILED_KEY)).toBe('1/1');
      expect(db.status.get(TICK_SKIPPED_KEY)).toBe('later');
    },
    10_000,
  );

  it('the jobs a slow tick skipped run first on the next tick', async () => {
    mode.hang = 'google';
    await runTick(new Date(), BUDGET_MS);
    expect(ranLater).toEqual([]);
    const next = await runTick(new Date(), BUDGET_MS);
    expect(ranLater).toEqual(['later']);
    expect(next.ran[0]).toBe('later');
    expect(next.failed).toEqual(['hangs']);
    expect(db.status.get(TICK_FAILED_KEY)).toBe('1/2');
  }, 10_000);

  it('a healthy tick runs every job in order and records no failures', async () => {
    mode.hang = 'none';
    const result = await runTick(new Date(), BUDGET_MS);
    expect(result).toEqual({ ran: ['hangs', 'later'], skipped: [], failed: [] });
    expect(db.status.get(TICK_FAILED_KEY)).toBe('0/2');
    expect(db.status.get(TICK_SKIPPED_KEY)).toBe('');
  });
});
