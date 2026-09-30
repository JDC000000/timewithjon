// PR-G2 (Jon's Calendar re-run step 4, "Lock in: nothing happened"): Lock in, then leave the page 2 s into the
// 10 s undo window. Before, the POST went only when the window ended, so leaving meant no lock, silently. Now
// leaving commits it (pagehide / hidden / unmount, keepalive): the request is locked when Jon comes back.
// Seeds its own request in the loopback test DB on a free 2027 slot (counts_toward 'none': no weekly cap).
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { ACTIONS } from '../../../src/content/ui/admin-requests';
import { ROUTES } from '../../../src/ui/routes';
import { signInAs } from '../support/sessions';
import { expect, test } from '../support/fixtures';

async function db<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** A requested, uncapped request whose one time is a free 2027 slot (picked under a lock: workers never share). */
const seedRequest = () =>
  db(async (c) => {
    await c.query('begin');
    try {
      await c.query(`select pg_advisory_xact_lock(hashtext('twj_e2e_lock_leave'))`);
      const {
        rows: [slot],
      } = await c.query<{ id: string }>(
        // Open for the flat white (lunch only, else 'window' disables Lock in): no block, offer or household hold
        // on it, and no lock anywhere in its week (no clash, no Big Day, no full week).
        `select s.id from slot s join week w on w.week_start = date_trunc('week', s.date)::date
          where s.date >= '2027-01-01' and s.window_kind = 'lunch' and s.date <> '2027-04-01'
            and not exists (select 1 from request_slot_choice x where x.slot_id = s.id)
            and not exists (select 1 from offer o where s.id = any(o.slot_ids) or o.taken_slot_id = s.id)
            and not exists (select 1 from availability_block b where s.date between b.start_date and b.end_date)
            and not exists (select 1 from request r where r.status = 'locked'
                              and r.locked_starts_at::date between w.week_start - 1 and w.week_start + 8)
          order by s.date desc limit 1`,
      );
      if (!slot) throw new Error('no free 2027 slot in the test DB');
      const email = `g2-${randomUUID()}@example.com`;
      const {
        rows: [req],
      } = await c.query<{ id: string }>(
        `with g as (insert into guest (email) values ($1) returning id)
         insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode,
                              counts_toward, status)
         select $2, g.id, (select id from invite where token_secret = 'g3hx8q2v'), 'Lee Park', $1,
                'the-flat-white', 'slots', 'none', 'requested'
           from g returning id`,
        [email, randomUUID()],
      );
      await c.query(`insert into request_slot_choice (request_id, slot_id) values ($1, $2)`, [
        req!.id,
        slot.id,
      ]);
      await c.query('commit');
      return req!.id;
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
  });

const status = (id: string) =>
  db(
    async (c) =>
      (await c.query<{ status: string }>(`select status from request where id = $1`, [id])).rows[0]!.status,
  );

// WebKit logs the RSC prefetches the leave aborts ("… ?_rsc=… due to access control checks"): that is the navigation
// under test, not an app error. Everything else still fails the test (asserted at the end).
test.use({ allowPageErrors: true });

test('Lock in, leave 2 s into the undo window: the lock still lands, and the request reads locked on return', async ({
  page,
  baseURL,
  pageErrors,
}) => {
  // The desktop pane (>= 600 px); the phone layout's sticky bar is covered by its own specs.
  test.skip((page.viewportSize()?.width ?? 0) < 600, 'desktop detail pane only');
  const id = await seedRequest();
  await signInAs(page.context(), 'admin', baseURL!);
  const detail = `${ROUTES.admin.requestsPrefix}/${id}`;
  expect((await page.goto(detail))?.status()).toBe(200);
  const lockIn = page.getByRole('button', { name: new RegExp(`^${ACTIONS.lockIn}`) });
  await expect(lockIn).toBeEnabled(); // the seeded time is open: nothing to tick
  await lockIn.click();
  await expect(page.getByRole('button', { name: /Undo/ })).toBeVisible();
  await page.waitForTimeout(2_000);
  expect(await status(id)).toBe('requested'); // still inside the window: nothing sent yet
  await page.goto(ROUTES.admin.requests); // leave mid-window
  await expect.poll(() => status(id), { timeout: 10_000 }).toBe('locked');
  await page.goto(detail);
  await expect(page.getByRole('button', { name: new RegExp(`^${ACTIONS.lockIn}`) })).toHaveCount(0);
  // Well past the old window's end: still exactly one lock (no second POST, no refusal).
  await page.waitForTimeout(9_000);
  expect(await status(id)).toBe('locked');
  const events = await db(
    async (c) =>
      (await c.query(`select 1 from audit_log where request_id = $1 and action = 'request_locked'`, [id]))
        .rowCount,
  );
  expect(events).toBe(1);
  expect(pageErrors.filter((e) => !/\?_rsc=\S+ due to access control checks\.$/.test(e))).toEqual([]);
});
