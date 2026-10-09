// QA4 M1 + M2 + L3 (proto walkthrough r4, 2026-10-08): what the guest told Jon reaches the admin. A Shore Ride asked
// with only a rough window and "It's one night away" shows both on the detail and its inbox row, and its Lock in…
// opens the dates sheet with a season date field and the "one night away" length picked. A Long Distance request
// shows the guest's time zone. Seeds its own invite and requests (no chosen times: nothing to clash); the sheet is
// closed without locking (no week is used up), and the rows are cancelled at the end.
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { DETAIL, LOCK_SHEET } from '../../../src/content/ui/admin-requests';
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

const seed = (
  who: string,
  cols: { dish: string; datePrefs: unknown; overnight: boolean; zone: string | null },
) =>
  db(async (c) => {
    const {
      rows: [invite],
    } = await c.query<{ id: string }>(
      `insert into invite (kind, token_secret, name_slug, is_test) values ('personal', $1, 'qa4-facts', true)
       returning id`,
      [token()],
    );
    const email = `qa4-${randomUUID()}@example.com`;
    const { rows } = await c.query<{ id: string }>(
      `with g as (insert into guest (email) values ($1) returning id)
       insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, counts_toward,
                            status, date_prefs, overnight, guest_time_zone, awaiting_jon_since)
       select $2, g.id, $3, $4, $1, $5, 'dates', 'big_day', 'requested', $6, $7, $8, now() from g returning id`,
      [
        email,
        randomUUID(),
        invite!.id,
        who,
        cols.dish,
        JSON.stringify(cols.datePrefs),
        cols.overnight,
        cols.zone,
      ],
    );
    return rows[0]!.id;
  });

const seeded: string[] = [];
test.afterEach(() =>
  db((c) =>
    c.query(
      `update request set status = 'cancelled', cancelled_at = now(), awaiting_jon_since = null
        where id = any($1::uuid[])`,
      [seeded.splice(0)],
    ),
  ),
);

const fact = (page: import('@playwright/test').Page, label: string) =>
  page.locator('dl.kv dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');

test('M1 + M2: a rough window and "one night away" show on the detail and the row; Lock in… asks for a date', async ({
  page,
  baseURL,
}) => {
  const who = `Qa Window ${token()}`;
  const id = await seed(who, {
    dish: 'the-shore-ride',
    datePrefs: { dates: [], window_text: 'Any weekend in late May' },
    overnight: true,
    zone: null,
  });
  seeded.push(id);
  await signInAs(page.context(), 'admin', baseURL!);
  expect((await page.goto(`${ROUTES.admin.requestsPrefix}/${id}`))?.status()).toBe(200);
  await expect(fact(page, DETAIL.labels.when)).toHaveText('Any weekend in late May');
  await expect(fact(page, DETAIL.labels.away)).toHaveText('one night away');

  const lock = page.getByRole('button', { name: LOCK_SHEET.lockOpen });
  await expect(lock).toBeEnabled();
  await lock.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByLabel(LOCK_SHEET.date)).toHaveAttribute('type', 'date');
  await expect(sheet.getByRole('radio', { name: 'one night away' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  if ((page.viewportSize()?.width ?? 0) >= 1000) {
    // the desktop list pane: the row says it too
    const row = page.getByRole('link', { name: new RegExp(who) });
    await expect(row).toContainText('Any weekend in late May');
    await expect(row).toContainText('one night away');
  }
});

test('L3: a Long Distance request shows the guest’s time zone', async ({ page, baseURL }) => {
  const id = await seed(`Qa Zone ${token()}`, {
    dish: 'the-long-distance',
    datePrefs: { dates: ['2027-05-08'], window_text: null },
    overnight: false,
    zone: 'America/St_Johns',
  });
  seeded.push(id);
  await signInAs(page.context(), 'admin', baseURL!);
  await page.goto(`${ROUTES.admin.requestsPrefix}/${id}`);
  await expect(fact(page, DETAIL.labels.zone)).toHaveText('St. John’s (Newfoundland)');
});
