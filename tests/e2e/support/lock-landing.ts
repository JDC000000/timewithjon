// tests/e2e/support/lock-landing.ts — A3b Lock in, split into its real phases (main red, PR #126):
//   1. the undo window: the POST /lock goes out only when the toast's count runs out (DetailPane onExpire);
//   2. the round trip: the POST's answer;
//   3. the A3 UI: 'Locked in. Invite sent.' with the normal expect budget.
// One expect used to cover all three (20 s = ~10 s designed delay + the round trip). Now each has its own bound
// (the round trip's, LOCK_ROUND_TRIP_MS, sized for the work the route does before it answers):
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
/**
 * The POST /lock round trip. The route answers only after its side effects ran inline (AD-1, runAfterCommit in
 * src/features/requests/side-effects.ts): the calendar row, then E4 rendered with its .ics and sent. That is real
 * work, not a stall: on a busy WebKit CI run the answer came at 5.75 s (main c18f9f2; the DB idle, no lock waits),
 * past the generic 5 s expect budget it used to share. A stuck POST still fails here, with pg_stat_activity attached.
 */
const LOCK_ROUND_TRIP_MS = 15_000;

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

/** The POST /lock of the next lock on this page, armed before the click that starts the undo window. */
export interface LockWatch {
  sent: Promise<Request>;
  answered: Promise<Response>;
}

/** Arms the waits for the next POST /lock (call it before the click, so the request can't slip past). */
export function watchLock(page: Page): LockWatch {
  // Bounded later by within(), so no timeout of their own.
  const sent = page.waitForRequest(isLockPost, { timeout: 0 });
  const answered = page.waitForResponse((r: Response) => isLockPost(r.request()), { timeout: 0 });
  sent.catch(() => undefined); // the page may close on an earlier red; the bound in lockAnswered reports it
  answered.catch(() => undefined);
  return { sent, answered };
}

/**
 * With the undo toast showing: the POST /lock goes out when the toast's own count runs out, and is answered within
 * LOCK_ROUND_TRIP_MS. Each phase has its own bound; on a timeout pg_stat_activity is attached. Returns the answer
 * (200, or 409 for the loser of a race): the caller says what it expects of it.
 */
export async function lockAnswered(page: Page, testInfo: TestInfo, watch: LockWatch): Promise<Response> {
  // The run's expect budget (playwright.config expect.timeout; the public FullProject type omits it).
  const budget = (testInfo.project as { expect?: { timeout?: number } }).expect?.timeout ?? EXPECT_BUDGET_MS;
  // Scoped to the toast's count line: a visually hidden status repeats the same words, so a page-wide
  // getByText matches two nodes (strict-mode violation on chromium/webkit 1440).
  const count = page.locator('[data-toast-sub]').filter({ hasText: countdownPattern() });
  await expect(count).toBeVisible();
  const seconds = Number(countdownPattern().exec((await count.textContent()) ?? '')?.[1]);
  expect(seconds, `undo window seconds from "${LOCK.countdown(0)}"`).toBeGreaterThan(0);
  try {
    // The window: the app's own seconds, plus one expect budget for the tick/in-view start.
    await within(watch.sent, seconds * 1_000 + budget, 'POST /lock not sent when the undo window ran out');
    await within(watch.answered, LOCK_ROUND_TRIP_MS, 'POST /lock sent but not answered');
  } catch (e) {
    await attachDbActivity(testInfo, 'pg_stat_activity at lock timeout');
    throw e;
  }
  return watch.answered;
}

/**
 * Start a lock the caller's way (`start`: Lock in, or a Lock sheet's commit) and see it land: the undo window and the
 * round trip each within their own bound (lockAnswered), the answer OK, then the A3 status line says it is sent.
 */
export async function landLock(page: Page, testInfo: TestInfo, start: () => Promise<void>): Promise<void> {
  const watch = watchLock(page);
  await start();
  const res = await lockAnswered(page, testInfo, watch);
  expect(res.ok(), `POST /lock answered ${res.status()}`).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: LOCK.sent })).toBeVisible();
}

/**
 * Lock in on A3 and see it land: the undo window runs out (bounded by the toast's own count), the POST /lock
 * is answered within LOCK_ROUND_TRIP_MS (it sends E4 inline), then the A3 status line says it is sent.
 */
export async function lockInAndLand(page: Page, testInfo: TestInfo): Promise<void> {
  await landLock(page, testInfo, () => lockIn(page));
}
