// T3.12.U1 S19 /story (a story without a booking), in real browsers against the loopback test DB. The invite
// session is the signed twj_invite cookie the app issues (C2), for the seeded general invite. Photo storage is the
// prototype's (POST /api/photos/sign answers { mock: true }, §5.5), so nothing leaves the box; the 2-photo save
// through the real pipeline is proven in tests/int/stories.int.test.ts.
// AC1: a story and 2 photos save with source 'story_page'. AC2: /story can't be reached without an invite.
// QA r2 H1: a second visit starts a new story and never overwrites the first. M4: the general link asks for a name.
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { Client } from 'pg';
import { AFTER_SEND } from '../../../src/content';
import { PHOTO_PICKER, STALE, STORY_FORM } from '../../../src/content/ui/guest-after';
import { signCookie } from '../../../src/features/invites/tokens';
import { expect, test } from '../support/fixtures';
import { PHOTO_ADDED_MS, sendStoryAndSee } from '../support/server-bounds';

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
async function freshInvite(label = 'S19 photo-first'): Promise<string> {
  const secret = Array.from(
    { length: 8 },
    () => 'abcdefghjkmnpqrstvwxyz23456789'[Math.floor(Math.random() * 30)],
  ).join('');
  const [row] = await sql<{ id: string }>(
    `insert into invite (kind, token_secret, name_slug, display_name, is_test)
     values ('personal', $1, $2, $3, true) returning id`,
    [secret, `e2e-s19-${secret}`, label],
  );
  return row!.id;
}

// New story-page stories are limited per invite per day; every run here starts with a fresh allowance.
test.beforeEach(() => sql(`delete from rate_limit where scope = 'storyPageNew'`, []));

async function openStory(page: Page): Promise<void> {
  const response = await page.goto(STORY_PATH);
  expect(response?.status()).toBe(200);
  // Hydrated before typing: a fill that lands first is wiped by React (seen on WebKit 375, CI run 36634386104).
  await page.waitForLoadState('networkidle');
}

test('S19 AC1 + QA r2 H1: a story saves; a second visit with 2 photos is a new story, the first is kept', async ({
  page,
  baseURL,
}) => {
  const inviteId = await withInvite(page, baseURL, await freshInvite('S19 two visits'));
  const first = `S19 ${randomUUID()}: the lunch that ran to dinner.`;
  await openStory(page);
  await expect(page.getByRole('textbox', { name: STORY_FORM.nameLabel })).toHaveCount(0); // a personal link names its guest
  await page.getByRole('textbox', { name: AFTER_SEND.question }).fill(first);
  await expect(page.getByRole('textbox', { name: AFTER_SEND.question })).toHaveValue(first);
  await page.getByRole('checkbox', { name: AFTER_SEND.consent }).check();
  await sendStoryAndSee(page, () => page.getByRole('button', { name: STORY_FORM.send }).click());
  const saved = await sql<{ id: string; source: string; invite_id: string; consent: boolean }>(
    `select id, source, invite_id, consent from story where body = $1`,
    [first],
  );
  expect(saved).toEqual([
    { id: expect.any(String), source: 'story_page', invite_id: inviteId, consent: true },
  ]);

  // Back on S19 while the first save's twj_story is still set: 2 photos go up and Send saves a NEW story.
  await openStory(page);
  await page.getByLabel(AFTER_SEND.photoButton).setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'b.png', mimeType: 'image/png', buffer: PNG },
  ]);
  for (const n of [1, 2]) {
    await expect(
      page.getByRole('group', { name: PHOTO_PICKER.photoName(n) }).getByText(PHOTO_PICKER.added),
    ).toBeVisible({ timeout: PHOTO_ADDED_MS }); // a server round trip per photo (support/server-bounds.ts)
  }
  await expect(page.getByText(PHOTO_PICKER.full(2, 2))).toBeVisible();
  const second = `S19 ${randomUUID()}: and the photos.`;
  await page.getByRole('textbox', { name: AFTER_SEND.question }).fill(second);
  await expect(page.getByRole('textbox', { name: AFTER_SEND.question })).toHaveValue(second);
  await sendStoryAndSee(page, () => page.getByRole('button', { name: STORY_FORM.send }).click());
  const rows = await sql<{ source: string; body: string }>(
    `select source, body from story where invite_id = $1 order by created_at`,
    [inviteId],
  );
  expect(rows).toEqual([
    { source: 'story_page', body: first },
    { source: 'story_page', body: second },
  ]);
});

test('S19 QA r2 M4: on the general link the guest can give a name, and the story keeps it', async ({
  page,
  baseURL,
}) => {
  await withInvite(page, baseURL);
  const body = `S19 ${randomUUID()}: from the general link.`;
  await openStory(page);
  const name = page.getByRole('textbox', { name: STORY_FORM.nameLabel });
  await name.fill('Gina Ruiz');
  await expect(name).toHaveValue('Gina Ruiz');
  await page.getByRole('textbox', { name: AFTER_SEND.question }).fill(body);
  await expect(page.getByRole('textbox', { name: AFTER_SEND.question })).toHaveValue(body);
  await sendStoryAndSee(page, () => page.getByRole('button', { name: STORY_FORM.send }).click());
  expect(await sql(`select from_name from story where body = $1`, [body])).toEqual([
    { from_name: 'Gina Ruiz' },
  ]);
});

test('S19 AC1 photo-first: 2 photos picked at once before the first Send make exactly 1 story_page story', async ({
  page,
  baseURL,
}) => {
  // T3.12.U1-F3: neither photo has a story yet; the sign gate (uploader.ts) holds the 2nd until the 1st has saved
  // the story (the first save creates it and issues twj_story), so there is no orphan empty story.
  const inviteId = await withInvite(page, baseURL, await freshInvite());
  await openStory(page);
  await page.getByLabel(AFTER_SEND.photoButton).setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'b.png', mimeType: 'image/png', buffer: PNG },
  ]);
  for (const n of [1, 2]) {
    await expect(
      page.getByRole('group', { name: PHOTO_PICKER.photoName(n) }).getByText(PHOTO_PICKER.added),
    ).toBeVisible({ timeout: PHOTO_ADDED_MS }); // a server round trip per photo (support/server-bounds.ts)
  }
  const body = `S19 ${randomUUID()}: photos first, words after.`;
  await page.getByRole('textbox', { name: AFTER_SEND.question }).fill(body);
  await expect(page.getByRole('textbox', { name: AFTER_SEND.question })).toHaveValue(body);
  await page.getByRole('checkbox', { name: AFTER_SEND.consent }).check();
  await sendStoryAndSee(page, () => page.getByRole('button', { name: STORY_FORM.send }).click());
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
