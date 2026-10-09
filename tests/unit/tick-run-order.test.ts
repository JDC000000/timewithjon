// CR-08 (full review 2026-10-08): a job that uses up every tick's budget (outbox-retry during a Google outage) must
// not halve the cadence of the jobs after it. The jobs a tick skipped run first on the next one, and the job that
// used the budget up runs last, so from the second tick of an outage every job runs on every tick.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../fixtures/unit-env';

const db = vi.hoisted(() => ({ status: new Map<string, string>() }));
vi.mock('@/lib/db', () => ({
  q: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith('select key, value from system_status')) {
      return (params[0] as string[]).flatMap((key) =>
        db.status.has(key) ? [{ key, value: db.status.get(key)! }] : [],
      );
    }
    if (sql.includes('insert into system_status')) {
      for (let i = 1; i < params.length; i += 2) db.status.set(params[i] as string, params[i + 1] as string);
      return [];
    }
    throw new Error(`unexpected query: ${sql}`);
  }),
}));
vi.mock('@/lib/report', () => ({ report: vi.fn(), reportMessage: vi.fn(), errorName: () => 'Error' }));

import { registerJob, runTick, TICK_OVERRAN_KEY } from '@/features/jobs/registry';

// Wide enough that a do-nothing job never outlasts it on a loaded runner: only the burner may.
const BUDGET_MS = 1000;
const outage = { on: true };
const quick = (name: string) => registerJob({ name, run: async () => {} });

quick('first');
quick('second');
// Stands in for outbox-retry while Google hangs: it returns only once the tick's budget is gone (the hard stop).
registerJob({
  name: 'burner',
  async run(_now, deadline) {
    if (outage.on) await new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now()) + 5));
  },
});
quick('after-1');
quick('after-2');

beforeEach(() => {
  db.status.clear();
  outage.on = true;
});

describe('runTick run order during a provider outage (CR-08)', () => {
  it('after the first tick, every job runs on every tick; the burner runs last', async () => {
    const first = await runTick(new Date(), BUDGET_MS);
    expect(first).toEqual({
      ran: ['first', 'second', 'burner'],
      skipped: ['after-1', 'after-2'],
      failed: [],
    });
    expect(db.status.get(TICK_OVERRAN_KEY)).toBe('burner');

    for (let tick = 2; tick <= 5; tick++) {
      const t = await runTick(new Date(), BUDGET_MS);
      expect(t.skipped).toEqual([]);
      expect(t.ran.at(-1)).toBe('burner');
      expect(new Set(t.ran)).toEqual(new Set(['first', 'second', 'burner', 'after-1', 'after-2']));
    }
  }, 30_000);

  it('once the outage is over, the burner goes back to its own place', async () => {
    await runTick(new Date(), BUDGET_MS);
    outage.on = false;
    await runTick(new Date(), BUDGET_MS); // the skipped ones first, the burner last (it no longer overruns)
    expect(db.status.get(TICK_OVERRAN_KEY)).toBe('');
    expect((await runTick(new Date(), BUDGET_MS)).ran).toEqual([
      'first',
      'second',
      'burner',
      'after-1',
      'after-2',
    ]);
  }, 30_000);
});
