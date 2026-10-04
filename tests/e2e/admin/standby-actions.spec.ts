// A stand-by request is acted on like an open one (Jon, 2026-10-04): its detail offers Lock in and Suggest another
// time, no "Move to stand-by" (it is already there) and no Before 60 box (that one is for after the time together).
// On the desktop pane, Lock in then locks it. Seeds its own stand-by request on a free 2027 lunch, under the same
// advisory lock as lock-leave.spec.ts so the two never pick one slot. STANDBY_SHOTS=<dir> also writes screenshots.
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { ACTIONS, LOCK, NOTES } from '../../../src/content/ui/admin-requests';
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

const seedStandby = () =>
  db(async (c) => {
    await c.query('begin');
    try {
      await c.query(`select pg_advisory_xact_lock(hashtext('twj_e2e_lock_leave'))`);
      const {
        rows: [slot],
      } = await c.query<{ id: string; week: string }>(
        `select s.id, w.week_start::text as week from slot s join week w on w.week_start = date_trunc('week', s.date)::date
          where s.date >= '2027-01-01' and s.window_kind = 'lunch' and s.date <> '2027-04-01'
            and not exists (select 1 from request_slot_choice x where x.slot_id = s.id)
            and not exists (select 1 from offer o where s.id = any(o.slot_ids) or o.taken_slot_id = s.id)
            and not exists (select 1 from availability_block b where s.date between b.start_date and b.end_date)
            and not exists (select 1 from request r where r.status = 'locked'
                              and r.locked_starts_at::date between w.week_start - 1 and w.week_start + 8)
          order by s.date desc limit 1`,
      );
      if (!slot) throw new Error('no free 2027 slot in the test DB');
      const {
        rows: [req],
      } = await c.query<{ id: string }>(
        `with g as (insert into guest (email) values ($1) returning id)
         insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode,
                              counts_toward, status, standby_week)
         select $2, g.id, (select id from invite where token_secret = 'g3hx8q2v'), 'Robin Wait', $1,
                'the-flat-white', 'slots', 'none', 'standby', $3::date
           from g returning id`,
        [`sb-${randomUUID()}@example.com`, randomUUID(), slot.week],
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

test('a stand-by request offers Lock in and Suggest, not Move to stand-by or Before 60; Lock in locks it', async ({
  page,
  baseURL,
}) => {
  const id = await seedStandby();
  await signInAs(page.context(), 'admin', baseURL!);
  expect((await page.goto(`${ROUTES.admin.requestsPrefix}/${id}`))?.status()).toBe(200);
  const lockIn = page.getByRole('button', { name: new RegExp(`^${ACTIONS.lockIn}`) });
  await expect(lockIn).toBeVisible();
  await expect(page.getByLabel(NOTES.before60)).toHaveCount(0);
  const phone = (page.viewportSize()?.width ?? 0) < 600;
  const dir = process.env.STANDBY_SHOTS;
  if (dir)
    await page.screenshot({ path: `${dir}/standby-actions-2026-10-04-${phone ? 'phone' : 'desktop'}.png` });
  const more = page.getByRole('button', { name: ACTIONS.more('Robin Wait') }).filter({ visible: true });
  await more.click();
  if (phone) {
    // the phone's More sheet: Suggest first (wireframe 09 A3c2), and no Move to stand-by
    const sheet = page.getByRole('dialog', { name: ACTIONS.more('Robin Wait') });
    await expect(sheet.getByRole('button', { name: ACTIONS.suggest })).toBeVisible();
    await expect(sheet.getByRole('button', { name: ACTIONS.standby })).toHaveCount(0);
    return; // the lock itself: the desktop pane (as lock-leave.spec.ts)
  }
  await expect(page.getByRole('button', { name: ACTIONS.suggest })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: ACTIONS.copyEmail })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: ACTIONS.standby })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(lockIn).toBeEnabled();
  await lockIn.click();
  await expect(page.getByText(LOCK.sent)).toBeVisible({ timeout: 15_000 });
  expect(await status(id)).toBe('locked');
});
