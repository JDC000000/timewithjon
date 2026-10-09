// U4 PR2 (S11 After Send, T1.8.U1 + T1.8.U2): the photo picker's tile states and the stand-by receipt line, in real
// browsers, with the copy Jon approved in decision 49 (2026-09-28). Each test seeds its own request row in the
// loopback test DB and signs the twj_req capability the way the app does (C2); photo storage is mocked
// (POST /api/photos/sign answers { mock: true }, as the prototype does), so nothing leaves the box.
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { Client } from 'pg';
import { STORY_FORM, PHOTO_PICKER, AFTER_SEND_STANDBY } from '../../../src/content/ui/guest-after';
import { AFTER_SEND } from '../../../src/content';
import { signCookie } from '../../../src/features/invites/tokens';
import { ROUTES } from '../../../src/ui/routes';
import { expect, test } from '../support/fixtures';
import { sendStoryAndSee } from '../support/server-bounds';

const REQ_COOKIE = 'twj_req'; // src/features/invites/capability.ts REQ_COOKIE
const STANDBY_WEEK = '2027-04-12'; // a Monday; its Thu/Fri are Apr 15–16
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A request row for this test (unique guest + client key), stand-by or not; returns its id. */
async function seedRequest(standby: boolean): Promise<string> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('insert into week (week_start) values ($1) on conflict do nothing', [STANDBY_WEEK]);
    const email = `s11-${randomUUID()}@example.com`;
    const { rows } = await db.query<{ id: string }>(
      `with g as (insert into guest (email) values ($1) returning id)
       insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, counts_toward,
                            status, standby_week)
       select $2, g.id, (select id from invite where token_secret = 'g3hx8q2v'), 'Sam Rivera', $1,
              'the-flat-white', 'slots', 'weekly_cap', $3::request_status, $4::date
         from g returning id`,
      [email, randomUUID(), standby ? 'standby' : 'requested', standby ? STANDBY_WEEK : null],
    );
    return rows[0]!.id;
  } finally {
    await db.end();
  }
}

async function openSent(page: Page, baseURL: string | undefined, standby = false): Promise<void> {
  const id = await seedRequest(standby);
  const value = signCookie('req', id, 3600, process.env.SESSION_SIGNING_SECRET!);
  await page.context().addCookies([{ name: REQ_COOKIE, value, url: baseURL! }]);
  const response = await page.goto(ROUTES.sent);
  expect(response?.status()).toBe(200);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/photos/sign*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"mock":true}' }),
  );
});

test('S11 picker: a photo is a tile that reads Added (photo 1), announced once in #live; Remove brings the add control back', async ({
  page,
  baseURL,
}) => {
  await openSent(page, baseURL);
  const add = page.getByLabel(AFTER_SEND.photoButton);
  await add.setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG });
  const tile = page.getByRole('group', { name: PHOTO_PICKER.photoName(1) });
  await expect(tile).toHaveClass(/photo--added/);
  await expect(tile.locator('p')).toHaveText(PHOTO_PICKER.added);
  await expect(tile.locator('img')).toHaveCount(1);
  await expect(page.locator('#live')).toContainText(PHOTO_PICKER.addedSay);
  // pr94 F2: #live is the one place it's spoken; the tile's line is not a second live region.
  await expect(tile.locator('[role=status],[aria-live]')).toHaveCount(0);
  await tile.getByRole('button', { name: PHOTO_PICKER.remove }).click();
  await expect(tile).toHaveCount(0);
  await expect(add).toBeFocused();
});

test('S11 picker: two photos fill it — the add control goes and the full line shows', async ({
  page,
  baseURL,
}) => {
  await openSent(page, baseURL);
  await page.getByLabel(AFTER_SEND.photoButton).setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'b.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await expect(page.getByRole('group', { name: /^photo \d$/ })).toHaveCount(2);
  await expect(page.getByText(PHOTO_PICKER.full(2, 2))).toBeVisible();
  await expect(page.getByLabel(AFTER_SEND.photoButton)).toHaveCount(0);
});

test('S11 picker: while a photo uploads its tile reads Uploading with Stop, and Send waits for it', async ({
  page,
  baseURL,
}) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/photos/sign*', async (r) => {
    await held;
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{"mock":true}' });
  });
  await openSent(page, baseURL);
  await page.getByRole('textbox', { name: AFTER_SEND.question }).fill('A good lunch.');
  await page
    .getByLabel(AFTER_SEND.photoButton)
    .setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG });
  const tile = page.getByRole('group', { name: PHOTO_PICKER.photoName(1) });
  await expect(tile.locator('p')).toHaveText(PHOTO_PICKER.uploading);
  await expect(tile.getByRole('button', { name: PHOTO_PICKER.stop })).toBeVisible();
  await page.getByRole('button', { name: STORY_FORM.send }).click();
  await expect(page.getByRole('button', { name: STORY_FORM.waiting })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  // The photo lands, then the held Send saves the story (a server round trip: support/server-bounds.ts).
  await sendStoryAndSee(page, async () => release());
});

test('S11 picker: a refused upload reads "That one didn’t go through." with Try again; Try again adds it', async ({
  page,
  baseURL,
}) => {
  let refuse = true;
  // A 200 that isn't { mock | ok } is refused by the uploader (no console error, unlike a 5xx).
  await page.route('**/api/photos/sign*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: refuse ? '{}' : '{"mock":true}' }),
  );
  await openSent(page, baseURL);
  await page
    .getByLabel(AFTER_SEND.photoButton)
    .setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG });
  const tile = page.getByRole('group', { name: PHOTO_PICKER.photoName(1) });
  await expect(tile.locator('p')).toHaveText(PHOTO_PICKER.failed);
  await expect(tile).not.toHaveClass(/photo--added/);
  refuse = false;
  await tile.getByRole('button', { name: PHOTO_PICKER.tryAgain }).click();
  await expect(tile.locator('p')).toHaveText(PHOTO_PICKER.added);
  await expect(tile.locator('img')).toHaveCount(1);
  // pr94 F1: a refused photo filling the last slot can be removed; the add control comes back, focused.
  refuse = true;
  await page
    .getByLabel(AFTER_SEND.photoButton)
    .setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: PNG });
  const tile2 = page.getByRole('group', { name: PHOTO_PICKER.photoName(2) });
  await expect(tile2.locator('p')).toHaveText(PHOTO_PICKER.failed);
  await expect(page.getByLabel(AFTER_SEND.photoButton)).toHaveCount(0);
  await tile2.getByRole('button', { name: PHOTO_PICKER.remove }).click();
  await expect(tile2).toHaveCount(0);
  await expect(page.getByLabel(AFTER_SEND.photoButton)).toBeFocused();
});

test('S11 stand-by: the receipt holds the dish and "stand-by, Apr 15–16" (decision 49, line 9)', async ({
  page,
  baseURL,
}) => {
  await openSent(page, baseURL, true);
  const receipt = page.locator('.receipt');
  await expect(receipt.getByRole('listitem')).toHaveCount(1);
  await expect(receipt.getByRole('listitem')).toHaveText(AFTER_SEND_STANDBY.receiptLine('Apr 15–16'));
  await expect(page.getByText(AFTER_SEND_STANDBY.promise('Apr 12'))).toBeVisible();
});
