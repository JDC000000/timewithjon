// QA4 H1 (proto walkthrough r4b, 2026-10-08): a date dish (The Encore) in a full week. Lock in is checked before any
// "Locked in… invite goes out in 10 s": the dates sheet shows the server's refusal and the time lock's own tick
// ("Override this week: it would be the 3rd"); ticked, the undo window opens (Undo here: no week is used up).
// Seeds a free week (not one of BOOKED_WEEKS, under the lock-leave advisory lock) with two locked bookings, and an
// Encore request in it; everything is cancelled at the end. Desktop pane only (the sheet is one component).
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { LOCK } from '../../../src/content/ui/admin-requests';
import { ROUTES } from '../../../src/ui/routes';
import { BOOKED_WEEKS } from '../support/booked-weeks';
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
const token = () => Array.from(randomBytes(8), (b) => 'abcdefghjkmnpqrstvwxyz23456789'[b % 30]).join('');

const seeded: string[] = [];
const seed = (who: string) =>
  db(async (c) => {
    await c.query('begin');
    try {
      await c.query(`select pg_advisory_xact_lock(hashtext('twj_e2e_lock_leave'))`);
      const {
        rows: [w],
      } = await c.query<{ week: string }>(
        `select w.week_start::text as week from week w
          where w.week_start between '2027-04-05' and '2027-06-14' and w.week_start <> all($1::date[])
            and not exists (select 1 from request r where r.status in ('locked','done')
                              and r.locked_starts_at::date between w.week_start - 1 and w.week_start + 8)
            and not exists (select 1 from availability_block b where b.end_date >= w.week_start
                              and b.start_date <= w.week_start + 6)
          order by w.week_start desc limit 1`,
        [BOOKED_WEEKS],
      );
      if (!w) throw new Error('no free week in the test DB');
      const {
        rows: [inv],
      } = await c.query<{ id: string }>(
        `insert into invite (kind, token_secret, name_slug, is_test) values ('personal', $1, 'qa4-h1', true) returning id`,
        [token()],
      );
      const one = async (name: string, cols: string, vals: string) => {
        const { rows } = await c.query<{ id: string }>(
          `with g as (insert into guest (email) values ($1) returning id)
           insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, counts_toward,
                                status ${cols})
           select $2, g.id, $3, $4, $1, 'the-encore', 'dates', 'weekly_cap', ${vals} from g returning id`,
          [`h1-${randomUUID()}@example.com`, randomUUID(), inv!.id, name],
        );
        seeded.push(rows[0]!.id);
        return rows[0]!.id;
      };
      // two locked evenings (Tue, Wed): the week's cap of 2 is used up
      for (const day of [1, 2])
        await one(
          `H1 Booked ${day}`,
          ', locked_starts_at, locked_ends_at',
          `'locked', ((date '${w.week}' + ${day}) + time '19:00') at time zone 'America/Vancouver',
                     ((date '${w.week}' + ${day}) + time '22:00') at time zone 'America/Vancouver'`,
        );
      const thu = await c.query<{ d: string }>(`select (date '${w.week}' + 3)::text as d`);
      const id = await one(
        who,
        ', date_prefs, awaiting_jon_since',
        `'requested', '${JSON.stringify({ dates: [thu.rows[0]!.d], window_text: null })}'::jsonb, now()`,
      );
      await c.query('commit');
      return id;
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
  });
test.afterEach(() =>
  db((c) =>
    c.query(
      `update request set status = 'cancelled', cancelled_at = now(), awaiting_jon_since = null where id = any($1::uuid[])`,
      [seeded.splice(0)],
    ),
  ),
);

test('a date dish in a full week: refused before any toast, with Override this week; ticked, the window opens', async ({
  page,
  baseURL,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1000, 'desktop pane; the dates sheet is one component');
  const who = `H1 Guest ${token()}`;
  const id = await seed(who);
  await signInAs(page.context(), 'admin', baseURL!);
  await page.goto(`${ROUTES.admin.requestsPrefix}/${id}`);
  await page.locator('.actbar button', { hasText: /^Lock in/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: /^Lock in .+, 7 pm$/ }).click();
  await expect(sheet.getByRole('alert')).toHaveText(
    'That week is full. Tick Override this week to go ahead.',
  );
  await expect(page.getByRole('button', { name: /Undo/ })).toHaveCount(0);
  await sheet.getByRole('checkbox', { name: LOCK.overrideWeek('3rd') }).check();
  await sheet.getByRole('button', { name: /^Lock in .+, 7 pm$/ }).click();
  const undo = page.getByRole('button', { name: /Undo/ });
  await expect(undo).toBeVisible();
  await page.waitForTimeout(700); // the toast ignores Undo for its first 600 ms
  await undo.click();
  await expect(page.getByText(LOCK.undone(who))).toBeVisible();
  const status = await db(
    async (c) => (await c.query(`select status from request where id = $1`, [id])).rows[0]!.status,
  );
  expect(status).toBe('requested');
});
