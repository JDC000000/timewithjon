// T2.9.U2: A2b/A2c Check these answers in the real app (wireframe 09 A2b/A2c, n15; the merged T2.9.04 routes).
// Delete (spam only) asks in place, deletes the row and lands back on Check these with focus on a row or the list
// caption; Not spam moves the request to Needs a reply and queues Jon's E2. Seeds its own invite and two spam-suspect
// requests in the loopback test DB (never the shared seeded general link) and removes what is left at the end.
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { CHECK } from '../../../src/content/ui/admin-requests';
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

const token = () => Array.from(randomBytes(8), (b) => 'abcdefghjkmnpqrstvwxyz23456789'[b % 30]).join('');

/** A personal test invite and two requested, uncapped spam suspects on it (no chosen times: nothing to clash). */
const seed = () =>
  db(async (c) => {
    const {
      rows: [invite],
    } = await c.query<{ id: string }>(
      `insert into invite (kind, token_secret, name_slug, is_test) values ('personal', $1, 'check-these', true)
       returning id`,
      [token()],
    );
    const one = async (name: string) => {
      const email = `u2-${randomUUID()}@example.com`;
      const { rows } = await c.query<{ id: string }>(
        `with g as (insert into guest (email) values ($1) returning id)
         insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode,
                              counts_toward, status, spam_suspect)
         select $2, g.id, $3, $4, $1, 'the-flat-white', 'slots', 'none', 'requested', true from g returning id`,
        [email, randomUUID(), invite!.id, name],
      );
      return rows[0]!.id;
    };
    return { inviteId: invite!.id, doomed: await one('Pat Spam'), real: await one('Robin Real') };
  });

const row = (id: string) =>
  db(
    async (c) =>
      (
        await c.query<{ spam_suspect: boolean; waiting: boolean }>(
          `select spam_suspect, awaiting_jon_since is not null as waiting from request where id = $1`,
          [id],
        )
      ).rows[0] ?? null,
  );
const e2Count = (id: string) =>
  db(
    async (c) =>
      (await c.query(`select 1 from email_log where request_id = $1 and template = 'E2'`, [id])).rowCount,
  );

test('Check these: Delete asks first, deletes and lands on the list; Not spam moves it to Needs a reply with E2', async ({
  page,
  baseURL,
}) => {
  const s = await seed();
  try {
    await signInAs(page.context(), 'admin', baseURL!);

    // Delete (A2b -> A2c): the confirm first, then the row is gone and Check these is back with focus in the list.
    expect((await page.goto(`${ROUTES.admin.requestsPrefix}/${s.doomed}`))?.status()).toBe(200);
    await page.getByRole('button', { name: CHECK.delete, exact: true }).click();
    await expect(page.getByText(CHECK.confirm)).toBeFocused();
    await page.keyboard.press('Escape'); // Esc = Keep it
    await expect(page.getByRole('button', { name: CHECK.delete, exact: true })).toBeFocused();
    expect(await row(s.doomed)).not.toBeNull();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: CHECK.deleteIt, exact: true }).click();
    await expect(page).toHaveURL(/\/admin\?check=1$/);
    await expect.poll(() => row(s.doomed)).toBeNull();
    await expect(page.locator(`a[href="${ROUTES.admin.requestsPrefix}/${s.doomed}"]`)).toHaveCount(0);
    await expect(page.locator('#live')).toHaveText(CHECK.deleted('Pat Spam'));
    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.activeElement;
          return el?.id === 'check-these-caption' || !!el?.matches('a[href^="/admin/requests/"]');
        }),
      )
      .toBe(true);

    // Not spam: the request joins Needs a reply and Jon's E2 is queued; the page re-reads it as ordinary.
    expect((await page.goto(`${ROUTES.admin.requestsPrefix}/${s.real}`))?.status()).toBe(200);
    await page.getByRole('button', { name: CHECK.notSpam, exact: true }).click();
    await expect(page.locator('#live')).toHaveText(CHECK.movedToNeeds('Robin Real'));
    await expect.poll(() => row(s.real)).toEqual({ spam_suspect: false, waiting: true });
    expect(await e2Count(s.real)).toBe(1);
    await expect(page.getByRole('button', { name: CHECK.notSpam, exact: true })).toHaveCount(0);
  } finally {
    await db(async (c) => {
      await c.query(`delete from request where invite_id = $1`, [s.inviteId]);
      await c.query(`delete from invite where id = $1`, [s.inviteId]);
    });
  }
});
