// T2.7.U1 S17 "Manage my booking" (/manage?t=<token>), in real browsers against the loopback test DB, one case per
// TSD T2.7 acceptance criterion. Each test seeds its own request (unique email, its own lock window) and a manage
// token stored the way the app stores it (sha-256 of the raw token, action-tokens.ts), so nothing is shared.
// MANAGE_SHOTS=<dir> also writes the U4 review screenshots (390 + 1280 wide) of each state; CI leaves it unset.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { Client } from 'pg';
import { ALREADY, FLOW, GUEST_LABEL } from '../../../src/content';
import { MANAGE_UI } from '../../../src/content/manage';
import { STALE, STORY_FORM } from '../../../src/content/ui/guest-after';
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

interface Seed {
  dish?: string;
  status?: 'requested' | 'locked';
  mode?: 'slots' | 'dates';
  plan?: string;
  /** An invite of its own (AC6 revokes it); default the seeded general invite. A personal one, because
   *  invite_one_active_general allows only one live general invite and the seed already holds it. */
  ownInvite?: boolean;
  expired?: boolean;
}

/**
 * A lock window no other test uses. It starts after the seeded season (slots run 2027-04-01..06-30, and a lock
 * blocks its week for collision-cap / lock-leave through `locked_starts_at between week_start - 1 and + 8`, so the
 * last season week reaches 07-06): a random hour from 2027-07-08 over ~5 years. request_no_overlap is global, so a
 * rare clash with another worker's window is retried with a fresh one (seed()).
 */
function freeWindow(): { start: Date; end: Date } {
  const start = new Date(Date.UTC(2027, 6, 8, 19) + Math.floor(Math.random() * 5 * 365 * 24) * 3_600_000);
  return { start, end: new Date(start.getTime() + 2 * 3_600_000) };
}

/** request_no_overlap (exclusion constraint) refused the window. */
const isOverlap = (e: unknown) => (e as { code?: string }).code === '23P01';

async function seed(
  s: Seed = {},
): Promise<{ requestId: string; inviteId: string; token: string; lock: Date }> {
  const token = randomBytes(32).toString('base64url');
  return db(async (c) => {
    const inviteId = s.ownInvite
      ? (
          await c.query<{ id: string }>(
            `insert into invite (kind, token_secret, name_slug, is_test) values ('personal', $1, 'sam-rivera', true)
             returning id`,
            [Array.from(randomBytes(8), (b) => 'abcdefghjkmnpqrstvwxyz23456789'[b % 30]).join('')],
          )
        ).rows[0]!.id
      : (await c.query<{ id: string }>(`select id from invite where token_secret = 'g3hx8q2v'`)).rows[0]!.id;
    const locked = s.status === 'locked';
    // One statement (guest + request), so a refused window leaves nothing behind and the retry starts clean.
    const insert = (w: { start: Date; end: Date }) =>
      c.query<{ id: string }>(
        `with g as (insert into guest (email) values ($1) returning id)
         insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, counts_toward,
                              status, locked_starts_at, locked_ends_at, locked_where, surprise_plan_sealed)
         select $2, g.id, $3, 'Sam Rivera', $1, $4, $5::request_mode, 'weekly_cap', $6::request_status, $7, $8, $9, $10
           from g returning id`,
        [
          `s17-${randomUUID()}@example.com`,
          randomUUID(),
          inviteId,
          s.dish ?? 'the-flat-white',
          s.mode ?? 'slots',
          s.status ?? 'requested',
          locked ? w.start : null,
          locked ? w.end : null,
          locked ? 'Tomahawk, North Van' : null,
          s.plan ?? null,
        ],
      );
    let w = freeWindow();
    let rows: { id: string }[] | undefined;
    for (let attempt = 1; !rows; attempt++) {
      try {
        ({ rows } = await insert(w));
      } catch (e) {
        if (!isOverlap(e) || attempt >= 5) throw e;
        w = freeWindow();
      }
    }
    const requestId = rows[0]!.id;
    await c.query(
      `insert into action_token (token_hash, purpose, request_id, expires_at)
       values ($1, 'manage', $2, now() + $3::interval)`,
      [createHash('sha256').update(token, 'utf8').digest(), requestId, s.expired ? '-1 day' : '30 days'],
    );
    return { requestId, inviteId, token, lock: w.start };
  });
}

/** Everything a page view could touch for this request: its row and its token rows. */
const snapshot = (requestId: string) =>
  db(async (c) => {
    const r = await c.query(`select row_to_json(r)::text as j from request r where id = $1`, [requestId]);
    const t = await c.query(`select row_to_json(t)::text as j from action_token t where request_id = $1`, [
      requestId,
    ]);
    return JSON.stringify([r.rows, t.rows]);
  });

const statusOf = (requestId: string) =>
  db(
    async (c) =>
      (await c.query<{ status: string }>(`select status from request where id = $1`, [requestId])).rows[0]!
        .status,
  );

const url = (token: string) => `/manage?t=${encodeURIComponent(token)}`;

async function shot(page: Page, name: string) {
  const dir = process.env.MANAGE_SHOTS;
  if (!dir) return;
  const size = page.viewportSize();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true });
  }
  if (size) await page.setViewportSize(size);
}

// Every test posts from 127.0.0.1, so retries and --repeat-each would trip the per-IP manageAction limit (20/h).
test.beforeEach(() => db((c) => c.query(`delete from rate_limit where scope = 'manageAction'`)));

test('AC1: GET, HEAD and a link scanner prefetch of /manage?t= change nothing in the DB', async ({
  page,
  request,
}) => {
  const s = await seed({ status: 'locked' });
  const before = await snapshot(s.requestId);
  expect((await request.head(url(s.token))).status()).toBe(200);
  // Safe Links style: a bot GET with its own UA and prefetch headers, no cookies, no script.
  const scan = await request.get(url(s.token), {
    headers: { 'user-agent': 'Microsoft Office Protection', purpose: 'prefetch', 'sec-purpose': 'prefetch' },
  });
  expect(scan.status()).toBe(200);
  const res = await page.goto(url(s.token));
  expect(res?.status()).toBe(200);
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    MANAGE_UI.heading(GUEST_LABEL.locked, 'The Flat White'),
  );
  await expect(page.getByText(MANAGE_UI.calendarInvite)).toBeVisible();
  await expect(page.locator('.actions .note')).toContainText('Sending new times frees up');
  await shot(page, 'manage-locked');
  expect(await snapshot(s.requestId)).toBe(before);
});

test('AC2: the link opened again shows the request as it is now, not as it was', async ({ page }) => {
  const s = await seed({ dish: 'surprise-me', plan: 'Kayak to the island, then fish tacos on the dock.' });
  await page.goto(url(s.token));
  await expect(page.locator('.status-pill')).toHaveText(GUEST_LABEL.requested);
  // C4: the Surprise Me plan goes back to its owner (and only here).
  await expect(page.getByText(MANAGE_UI.ownPlan)).toBeVisible();
  await expect(page.getByText('Kayak to the island, then fish tacos on the dock.')).toBeVisible();
  await shot(page, 'manage-surprise');
  await db((c) =>
    c.query(`update request set status = 'cancelled', cancelled_at = now() where id = $1`, [s.requestId]),
  );
  await page.goto(url(s.token));
  await expect(page.locator('.status-pill')).toHaveText(GUEST_LABEL.cancelled);
  await expect(page.getByRole('button', { name: MANAGE_UI.cancel })).toHaveCount(0);
});

test('AC3: an expired link shows the friendly "text me" page', async ({ page }) => {
  const s = await seed({ expired: true });
  const res = await page.goto(url(s.token));
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(STALE.title);
  await expect(page.getByText(STALE.body)).toBeVisible();
  await shot(page, 'expired');
});

test('AC4: a tampered token is a 404', async ({ request }) => {
  // request.get, not page.goto: the page fixture fails a test on the 404's console error.
  const s = await seed();
  const bad = `${s.token.slice(0, -2)}${s.token.endsWith('AA') ? 'BB' : 'AA'}`;
  expect((await request.get(url(bad))).status()).toBe(404);
  expect((await request.get('/manage')).status()).toBe(404);
});

test('AC5: Cancel frees the locked window at once', async ({ page }) => {
  const s = await seed({ status: 'locked' });
  await page.goto(url(s.token));
  await page.getByRole('button', { name: MANAGE_UI.cancel }).click();
  await expect(page.locator('.status-pill')).toHaveText(GUEST_LABEL.cancelled);
  expect(await statusOf(s.requestId)).toBe('cancelled');
  // The same window can be locked by someone else straight away (request_no_overlap no longer holds it).
  const other = await seed({ status: 'locked' });
  await db((c) =>
    c.query(
      `update request set locked_starts_at = $2, locked_ends_at = $2::timestamptz + interval '2 hours' where id = $1`,
      [other.requestId, s.lock],
    ),
  );
  await shot(page, 'after-cancel');
  // A second Cancel from a stale tab is idempotent: "Already cancelled. No guilt."
  const again = await page.evaluate(
    async ({ h, t }) =>
      (
        await fetch('/api/manage/cancel', {
          method: 'POST',
          headers: { 'content-type': 'application/json', [h]: t },
          body: '{}',
          referrerPolicy: 'strict-origin',
        })
      ).json(),
    { h: 'x-twj-manage', t: s.token },
  );
  expect(again).toMatchObject({ ok: true, already: true, message: ALREADY.cancelled });
});

test('AC6: after the general link is rotated, Ask for another time still works end to end', async ({
  page,
}) => {
  const s = await seed({ dish: 'the-encore', mode: 'dates', ownInvite: true });
  await db((c) => c.query(`update invite set revoked_at = now() where id = $1`, [s.inviteId]));
  const seen: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/'))
      seen.push(`${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`);
  });
  await page.goto(url(s.token));
  await page.getByRole('button', { name: MANAGE_UI.askAnother }).click();
  const form = page.locator('form[data-manage-another="dates"]');
  await expect(form).toBeVisible();
  await shot(page, 'another-time');
  await form.getByLabel(FLOW.pitchWhenLabel).fill('sometime in June');
  await form.getByRole('button', { name: FLOW.send }).click();
  // The seed is already 'requested', so the pill proves nothing here: wait for the row itself.
  await expect
    .poll(() =>
      db(
        async (c) =>
          (
            await c.query<{ w: string | null }>(
              `select date_prefs->>'window_text' as w from request where id = $1`,
              [s.requestId],
            )
          ).rows[0]!.w,
      ),
    )
    .toBe('sometime in June');
  await expect(page.locator('.status-pill')).toHaveText(GUEST_LABEL.requested);
  // The token rode only in the header: no API call carried it in its URL.
  expect(seen).toContain('GET /api/availability?dish=the-encore');
  expect(seen.some((x) => x.includes(s.token))).toBe(false);
});

test('Add a story or photo opens the S11 story form, sent with the manage header', async ({ page }) => {
  const s = await seed({ status: 'locked' });
  await page.goto(url(s.token));
  await page.getByRole('button', { name: MANAGE_UI.addStory }).click();
  await expect(page.getByRole('button', { name: STORY_FORM.send })).toBeVisible();
  await shot(page, 'story-form');
});
