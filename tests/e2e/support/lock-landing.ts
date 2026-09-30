// tests/e2e/support/lock-landing.ts — A3b Lock in, split into its real phases (main red, PR #126):
//   1. the undo window: the POST /lock goes out only when the toast's count runs out (DetailPane onExpire);
//   2. the round trip: the POST's answer;
//   3. the A3 UI: 'Locked in. Invite sent.' with the normal expect budget.
// One expect used to cover all three (20 s = ~10 s designed delay + the round trip). Now each has its own bound:
// the window is read from the toast the app renders (LOCK.countdown), not a magic number. No sleeps, no retries.
// Failure-only: if the POST is not sent or not answered in time, pg_stat_activity (state, wait_event,
// pg_blocking_pids, query) and ungranted pg_locks go into the test's attachments, so the next red names the blocker.
import type { Page, Request, Response, TestInfo } from '@playwright/test';
import { Client } from 'pg';
import { LOCK } from '../../../src/content/ui/admin-requests';
import { expect } from './fixtures';
import { lockIn } from './flows';

/** Fallback only: mirrors playwright.config.ts expect.timeout (the config isn't imported: it has side effects). */
const EXPECT_BUDGET_MS = 5_000;

const isLockPost = (r: Request) =>
  r.method() === 'POST' && /\/api\/admin\/requests\/[^/]+\/lock$/.test(new URL(r.url()).pathname);

/** The toast's count line as the app words it (LOCK.countdown), with the seconds captured. */
function countdownPattern(): RegExp {
  const MARK = '\u0000';
  const [pre = '', post = ''] = LOCK.countdown(MARK as unknown as number).split(MARK);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${esc(pre)}(\\d+)${esc(post)}`);
}

/** Rejects with `what` after `ms` unless `p` settles first (a bound on a wait, not a sleep). */
async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} (bound ${ms} ms)`)), ms);
  });
  try {
    return await Promise.race([p, bound]);
  } finally {
    clearTimeout(timer);
  }
}

/** Failure-only: who holds what in the test DB right now. Never throws (a diagnostic must not mask the red). */
export async function attachDbActivity(testInfo: TestInfo, name: string): Promise<void> {
  let body: string;
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });
  try {
    await c.connect();
    const activity = await c.query(
      `select pid, application_name, backend_type, state, wait_event_type, wait_event,
              pg_blocking_pids(pid) as blocked_by,
              round(extract(epoch from now() - xact_start)::numeric, 3) as xact_s,
              round(extract(epoch from now() - query_start)::numeric, 3) as query_s,
              left(query, 800) as query
         from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid()
        order by xact_start nulls last`,
    );
    const waiting = await c.query(
      `select l.pid, l.locktype, l.mode, l.relation::regclass::text as relation, l.transactionid::text as xid,
              l.classid, l.objid
         from pg_locks l where not l.granted`,
    );
    body = JSON.stringify(
      {
        at: new Date().toISOString(),
        note: 'app pool stats: not exposed by the app (src/lib/db-config.ts: max 3, no connectionTimeoutMillis)',
        activity: activity.rows,
        ungrantedLocks: waiting.rows,
      },
      null,
      2,
    );
  } catch (e) {
    body = `pg_stat_activity unreachable: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    await c.end().catch(() => undefined);
  }
  await testInfo.attach(name, { body, contentType: 'application/json' });
}

/**
 * Lock in on A3 and see it land: the undo window runs out (bounded by the toast's own count), the POST /lock
 * is answered within the normal expect budget, then the A3 status line says it is sent.
 */
export async function lockInAndLand(page: Page, testInfo: TestInfo): Promise<void> {
  // The run's expect budget (playwright.config expect.timeout; the public FullProject type omits it).
  const budget = (testInfo.project as { expect?: { timeout?: number } }).expect?.timeout ?? EXPECT_BUDGET_MS;
  // Armed before the click so the request can't slip past; bounded below by within(), so no own timeout.
  const sent = page.waitForRequest(isLockPost, { timeout: 0 });
  const answered = page.waitForResponse((r: Response) => isLockPost(r.request()), { timeout: 0 });
  sent.catch(() => undefined); // the page may close on an earlier red; the bound below reports it
  answered.catch(() => undefined);

  await lockIn(page);
  // Scoped to the toast's count line: a visually hidden status repeats the same words, so a page-wide
  // getByText matches two nodes (strict-mode violation on chromium/webkit 1440).
  const count = page.locator('[data-toast-sub]').filter({ hasText: countdownPattern() });
  await expect(count).toBeVisible();
  const seconds = Number(countdownPattern().exec((await count.textContent()) ?? '')?.[1]);
  expect(seconds, `undo window seconds from "${LOCK.countdown(0)}"`).toBeGreaterThan(0);

  try {
    // The window: the app's own seconds, plus one expect budget for the tick/in-view start.
    await within(sent, seconds * 1_000 + budget, 'POST /lock not sent when the undo window ran out');
    await within(answered, budget, 'POST /lock sent but not answered');
  } catch (e) {
    await attachDbActivity(testInfo, 'pg_stat_activity at lock timeout');
    throw e;
  }
  const res = await answered;
  expect(res.ok(), `POST /lock answered ${res.status()}`).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: LOCK.sent })).toBeVisible();
}
