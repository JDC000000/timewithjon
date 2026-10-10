// evals/bugs: lock-sheet-no-place (r6): Jon locks a dated request through the Lock sheet with a place, and another
// without one. With a place: it is stored (E4 then says "Where: …"). Without: no place, as before. Seeds its own
// requests on a free week's Saturday (never a week another spec has seeded), desktop pane only; cancelled at the end.
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { LOCK, LOCK_SHEET } from '../../../src/content/ui/admin-requests';
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

/** A Shore Ride asked for on a free week's Saturday (a Big Day by date). */
const seed = (who: string) =>
  db(async (c) => {
    await c.query('begin');
    try {
      await c.query(`select pg_advisory_xact_lock(hashtext('twj_e2e_lock_leave'))`);
      const {
        rows: [w],
      } = await c.query<{ sat: string }>(
        `select (w.week_start + 5)::text as sat from week w
          where w.week_start between '2027-04-05' and '2027-06-14' and w.week_start <> all($1::date[])
            and not exists (select 1 from request r where r.status in ('locked','done')
                              and r.locked_starts_at::date between w.week_start - 1 and w.week_start + 8)
            and not exists (select 1 from request_slot_choice x join request xr on xr.id = x.request_id
                              join slot sl on sl.id = x.slot_id
                             where xr.status <> 'cancelled' and sl.date between w.week_start and w.week_start + 6)
            and not exists (select 1 from request xr where xr.status <> 'cancelled'
                              and (xr.standby_week = w.week_start
                                   or exists (select 1 from jsonb_array_elements_text(coalesce(xr.date_prefs -> 'dates', '[]'::jsonb)) d
                                               where d::date between w.week_start and w.week_start + 6)))
            and not exists (select 1 from availability_block b where b.end_date >= w.week_start
                              and b.start_date <= w.week_start + 6)
          order by w.week_start limit 1`,
        [BOOKED_WEEKS],
      );
      if (!w) throw new Error('no free week in the test DB');
      const {
        rows: [inv],
      } = await c.query<{ id: string }>(
        `insert into invite (kind, token_secret, name_slug, is_test) values ('personal', $1, 'r6-where', true) returning id`,
        [token()],
      );
      const { rows } = await c.query<{ id: string }>(
        `with g as (insert into guest (email) values ($1) returning id)
         insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, counts_toward,
                              status, date_prefs, awaiting_jon_since)
         select $2, g.id, $3, $4, $1, 'the-shore-ride', 'dates', 'big_day', 'requested', $5::jsonb, now() from g
         returning id`,
        [
          `where-${randomUUID()}@example.com`,
          randomUUID(),
          inv!.id,
          who,
          JSON.stringify({ dates: [w.sat], window_text: null }),
        ],
      );
      await c.query('commit');
      seeded.push(rows[0]!.id);
      return rows[0]!.id;
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
const placeOf = (id: string) =>
  db(
    async (c) =>
      (await c.query<{ w: string | null }>(`select locked_where as w from request where id = $1`, [id]))
        .rows[0]!.w,
  );

for (const place of ['North gate', null]) {
  test(`lock through the sheet ${place ? 'with a place' : 'without a place'}`, async ({ page, baseURL }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1000, 'desktop pane; the sheet is one component');
    const id = await seed(`Where ${token()}`);
    await signInAs(page.context(), 'admin', baseURL!);
    await page.goto(`${ROUTES.admin.requestsPrefix}/${id}`);
    await page.locator('.actbar button', { hasText: /^Lock in/ }).click();
    const sheet = page.getByRole('dialog');
    if (place) await sheet.getByRole('textbox', { name: LOCK_SHEET.where }).fill(place);
    await sheet.getByRole('button', { name: /^Lock in .+, 9 am$/ }).click();
    await expect(page.getByText(LOCK.sent)).toBeVisible({ timeout: 20_000 });
    expect(await placeOf(id)).toBe(place);
  });
}
