// T3.12.U1 S19 /story (a story without a booking), in real browsers against the loopback test DB. The invite
// session is the signed twj_invite cookie the app issues (C2), for the seeded general invite. Photo storage is the
// prototype's (POST /api/photos/sign answers { mock: true }, §5.5), so nothing leaves the box; the 2-photo save
// through the real pipeline is proven in tests/int/stories.int.test.ts.
// AC1: a story and 2 photos save with source 'story_page'. AC2: /story can't be reached without an invite.
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { Client } from 'pg';
import { AFTER_SEND } from '../../../src/content';
import { PHOTO_PICKER, STALE, STORY_FORM } from '../../../src/content/ui/guest-after';
import { signCookie } from '../../../src/features/invites/tokens';
import { expect, test } from '../support/fixtures';

const INVITE_COOKIE = 'twj_invite'; // src/features/invites/session.ts INVITE_COOKIE
const STALE_COOKIE = 'twj_stale'; // src/features/invites/session.ts STALE_COOKIE
const STORY_PATH = '/story';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function sql<T extends Record<string, unknown>>(text: string, values: unknown[]): Promise<T[]> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query<T>(text, values)).rows;
  } finally {
    await db.end();
  }
}

/** Signs the twj_invite cookie the way the invite link does: the seeded general invite, or `inviteId`. */
async function withInvite(page: Page, baseURL: string | undefined, inviteId?: string): Promise<string> {
  const id =
    inviteId ??
    (await sql<{ id: string }>(`select id from invite where token_secret = 'g3hx8q2v'`, []))[0]!.id;
  const value = signCookie('invite', id, 3600, process.env.SESSION_SIGNING_SECRET!);
  await page.context().addCookies([{ name: INVITE_COOKIE, value, url: baseURL! }]);
  return id;
}

/** A test invite of this test's own, so its story rows can be counted while other tests share the seeded one. */
async function freshInvite(): Promise<string> {
  const secret = Array.from(
    { length: 8 },
    () => 'abcdefghjkmnpqrstvwxyz23456789'[Math.floor(Math.random() * 30)],
  ).join('');
  const [row] = await sql<{ id: string }>(
    `insert into invite (kind, token_secret, name_slug, display_name, is_test)
     values ('personal', $1, $2, 'S19 photo-first', true) returning id`,
    [secret, `e2e-s19-${secret}`],
  );
  return row!.id;
}

async function openStory(page: Page): Promise<void> {
  const response = await page.goto(STORY_PATH);
  expect(response?.status()).toBe(200);
  // Hydrated before typing: a fill that lands first is wiped by React (seen on WebKit 375, CI run 36634386104).
  await page.waitForLoadState('networkidle');
}

test('S19 AC1: with an invite, a story then 2 photos save as one story with source story_page', async ({
  page,
  baseURL,
}) => {
  const inviteId = await withInvite(page, baseURL);
  const first = `S19 ${randomUUID()}: the lunch that ran to dinner.`;
  await openStory(page);
  await page.getByRole('textbox', { name: AFTER_SEND.question }).fill(first);
  await expect(page.getByRole('textbox', { name: AFTER_SEND.question })).toHaveValue(first);
  await page.getByRole('checkbox', { name: AFTER_SEND.consent }).check();
  await page.getByRole('button', { name: STORY_FORM.send }).click();
  await expect(page.getByText(AFTER_SEND.thanks)).toBeVisible();
  const saved = await sql<{ id: string; source: string; invite_id: string; consent: boolean }>(
    `select id, source, invite_id, consent from story where body = $1`,
    [first],
  );
  expect(saved).toEqual([
    { id: expect.any(String), source: 'story_page', invite_id: inviteId, consent: true },
  ]);

  // Back on S19 with the twj_story capability the first save issued: 2 photos go up, and Send updates that story.
  await openStory(page);
  await page.getByLabel(AFTER_SEND.photoButton).setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'b.png', mimeType: 'image/png', buffer: PNG },
  ]);
  for (const n of [1, 2]) {
    await expect(
      page.getByRole('group', { name: PHOTO_PICKER.photoName(n) }).getByText(PHOTO_PICKER.added),
    ).toBeVisible();
  }
  await expect(page.getByText(PHOTO_PICKER.full(2, 2))).toBeVisible();
  const second = `${first} And the photos.`;
  await page.getByRole('textbox', { name: AFTER_SEND.question }).fill(second);
  await expect(page.getByRole('textbox', { name: AFTER_SEND.question })).toHaveValue(second);
  await page.getByRole('button', { name: STORY_FORM.send }).click();
  await expect(page.getByText(AFTER_SEND.thanks)).toBeVisible();
  const after = await sql<{ id: string; source: string; body: string }>(
    `select id, source, body from story where id = $1`,
    [saved[0]!.id],
  );
  expect(after).toEqual([{ id: saved[0]!.id, source: 'story_page', body: second }]);
});

test('S19 AC1 photo-first: 2 photos picked at once before the first Send make exactly 1 story_page story', async ({
  page,
  baseURL,
}) => {
  // T3.12.U1-F3: both signs have no twj_story yet; the sign gate (uploader.ts) holds the 2nd until the 1st has
  // created the story and issued twj_story, so there is no orphan empty story.
  const inviteId = await withInvite(page, baseURL, await freshInvite());
  await openStory(page);
  await page.getByLabel(AFTER_SEND.photoButton).setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'b.png', mimeType: 'image/png', buffer: PNG },
  ]);
  for (const n of [1, 2]) {
    await expect(
      page.getByRole('group', { name: PHOTO_PICKER.photoName(n) }).getByText(PHOTO_PICKER.added),
    ).toBeVisible();
  }
  const body = `S19 ${randomUUID()}: photos first, words after.`;
  await page.getByRole('textbox', { name: AFTER_SEND.question }).fill(body);
  await expect(page.getByRole('textbox', { name: AFTER_SEND.question })).toHaveValue(body);
  await page.getByRole('checkbox', { name: AFTER_SEND.consent }).check();
  await page.getByRole('button', { name: STORY_FORM.send }).click();
  await expect(page.getByText(AFTER_SEND.thanks)).toBeVisible();
  const rows = await sql<{ source: string; body: string | null }>(
    `select source, body from story where invite_id = $1`,
    [inviteId],
  );
  expect(rows).toEqual([{ source: 'story_page', body }]);
});

test('S19 AC2: with no invite, /story is the stale page and there is no form', async ({ page }) => {
  await openStory(page);
  await expect(page.getByText(STALE.pill)).toBeVisible();
  await expect(page.getByRole('heading', { name: STALE.title })).toBeVisible();
  await expect(page.getByRole('textbox', { name: AFTER_SEND.question })).toHaveCount(0);
  await expect(page.getByRole('button', { name: STORY_FORM.send })).toHaveCount(0);
});

test('S19 AC2: with a stale invite, /story is the stale page and there is no form', async ({
  page,
  baseURL,
}) => {
  await page.context().addCookies([{ name: STALE_COOKIE, value: '1', url: baseURL! }]);
  await openStory(page);
  await expect(page.getByText(STALE.pill)).toBeVisible();
  await expect(page.getByRole('textbox', { name: AFTER_SEND.question })).toHaveCount(0);
});
