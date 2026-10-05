// Jon's decision (2026-10-05): after Jon cancels for the guest, /manage reads "Cancelled, no problem" and offers
// Ask for another time (their new times go back to Jon as a re-request) and Add a story or photo, never Cancel.
// The guest's own cancel keeps "Cancelled, no guilt" and no Ask for another time. Each case seeds its own request
// and manage token (sha-256 of the raw token, as action-tokens.ts stores it). MANAGE_SHOTS=<dir> writes the phone
// screenshot; CI leaves it unset.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { GUEST_LABEL, JON_CANCELLED_LABEL } from '../../../src/content';
import { MANAGE_UI } from '../../../src/content/manage';
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

/** A Long Lunch request cancelled by `by`, with a live manage token; returns the raw token. */
const cancelledBy = (by: 'jon' | 'guest') =>
  db(async (c) => {
    const token = randomBytes(32).toString('base64url');
    const {
      rows: [r],
    } = await c.query<{ id: string }>(
      `with g as (insert into guest (email) values ($1) returning id)
       insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, counts_toward,
                            status, cancelled_by, cancelled_at)
       select $2, g.id, (select id from invite where token_secret = 'g3hx8q2v'), 'Sam Rivera', $1, 'the-long-lunch',
              'slots', 'weekly_cap', 'cancelled', $3::cancelled_by, now()
         from g returning id`,
      [`s17c-${randomUUID()}@example.com`, randomUUID(), by],
    );
    await c.query(
      `insert into action_token (token_hash, purpose, request_id, expires_at) values ($1, 'manage', $2, now() + interval '30 days')`,
      [createHash('sha256').update(token, 'utf8').digest(), r!.id],
    );
    return token;
  });

test('after Jon cancels: "Cancelled, no problem", Ask for another time and Add a story or photo, no Cancel', async ({
  page,
}) => {
  const token = await cancelledBy('jon');
  expect((await page.goto(`/manage?t=${encodeURIComponent(token)}`))?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    MANAGE_UI.heading(JON_CANCELLED_LABEL, 'The Long Lunch'),
  );
  await expect(page.getByRole('button', { name: MANAGE_UI.askAnother })).toBeVisible();
  await expect(page.getByRole('button', { name: MANAGE_UI.addStory })).toBeVisible();
  await expect(page.getByRole('button', { name: MANAGE_UI.cancel, exact: true })).toHaveCount(0);
  const dir = process.env.MANAGE_SHOTS;
  if (dir && (page.viewportSize()?.width ?? 0) < 600)
    await page.screenshot({ path: `${dir}/manage-after-jon-cancel-2026-10-05-phone.png`, fullPage: true });
});

test("the guest's own cancel: 'Cancelled, no guilt', no Ask for another time", async ({ page }) => {
  const token = await cancelledBy('guest');
  expect((await page.goto(`/manage?t=${encodeURIComponent(token)}`))?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    MANAGE_UI.heading(GUEST_LABEL.cancelled, 'The Long Lunch'),
  );
  await expect(page.getByRole('button', { name: MANAGE_UI.askAnother })).toHaveCount(0);
  await expect(page.getByRole('button', { name: MANAGE_UI.addStory })).toBeVisible();
});
