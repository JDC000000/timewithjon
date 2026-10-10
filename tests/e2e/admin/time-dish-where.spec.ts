// evals/bugs: time-dish-no-place (TWJ11, Jon 2026-10-10): a time dish locks in one click from the detail page, now with
// the optional Where beside it. With a place: stored (E4 then says "Where: …"). With the field left empty: the
// one-click lock still goes, with no place. Seeds its own request on a free 2027 lunch (the earliest free week: the
// other lock specs take the latest), desktop pane only; cancelled at the end.
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { ACTIONS, LOCK, LOCK_SHEET } from '../../../src/content/ui/admin-requests';
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
const seeded: string[] = [];
const seed = () =>
  db(async (c) => {
    await c.query('begin');
    try {
      await c.query(`select pg_advisory_xact_lock(hashtext('twj_e2e_lock_leave'))`);
      const {
        rows: [slot],
      } = await c.query<{ id: string }>(
        `select s.id from slot s join week w on w.week_start = date_trunc('week', s.date)::date
          where s.date >= '2027-01-01' and s.window_kind = 'lunch' and s.date <> '2027-04-01'
            and w.week_start <> all($1::date[])
            and not exists (select 1 from request_slot_choice x join request xr on xr.id = x.request_id
                             join slot sl on sl.id = x.slot_id
                             where xr.status <> 'cancelled' and sl.date between w.week_start and w.week_start + 6)
            and not exists (select 1 from request xr where xr.status <> 'cancelled'
                              and (xr.standby_week = w.week_start
                                   or exists (select 1 from jsonb_array_elements_text(coalesce(xr.date_prefs -> 'dates', '[]'::jsonb)) d
                                               where d::date between w.week_start and w.week_start + 6)))
            and not exists (select 1 from offer o join request orq on orq.id = o.request_id
                             where orq.status <> 'cancelled' and (s.id = any(o.slot_ids) or o.taken_slot_id = s.id))
            and not exists (select 1 from availability_block b where s.date between b.start_date and b.end_date)
            and not exists (select 1 from request r where r.status = 'locked'
                              and r.locked_starts_at::date between w.week_start - 1 and w.week_start + 8)
          order by s.date limit 1`,
        [BOOKED_WEEKS],
      );
      if (!slot) throw new Error('no free 2027 slot in the test DB');
      const {
        rows: [req],
      } = await c.query<{ id: string }>(
        `with g as (insert into guest (email) values ($1) returning id)
         insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode,
                              counts_toward, status, awaiting_jon_since)
         select $2, g.id, (select id from invite where token_secret = 'g3hx8q2v'), 'Kim Where', $1,
                'the-flat-white', 'slots', 'none', 'requested', now()
           from g returning id`,
        [`tw-${randomUUID()}@example.com`, randomUUID()],
      );
      await c.query(`insert into request_slot_choice (request_id, slot_id) values ($1, $2)`, [
        req!.id,
        slot.id,
      ]);
      await c.query('commit');
      seeded.push(req!.id);
      return req!.id;
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
  test(`one-click lock of a time dish ${place ? 'with a place' : 'with the Where field empty'}`, async ({
    page,
    baseURL,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1000, 'desktop detail pane');
    const id = await seed();
    await signInAs(page.context(), 'admin', baseURL!);
    await page.goto(`${ROUTES.admin.requestsPrefix}/${id}`);
    if (place) await page.getByRole('textbox', { name: LOCK_SHEET.where }).fill(place);
    await page.getByRole('button', { name: new RegExp(`^${ACTIONS.lockIn}`) }).click();
    await expect(page.getByText(LOCK.sent)).toBeVisible({ timeout: 20_000 });
    expect(await placeOf(id)).toBe(place);
  });
}
