// T2.4.U2 S18 "take an offer" (/offer?t=) and "pick a new date" (/new-date?t=) in real browsers against the loopback
// test DB: the N2 contract (a GET with no side effects, one POST button) and TSD T2.4 AC1, AC4 and AC6 through the
// page. Each test seeds its own request, offer and single-use token (sha-256 of the raw token, as action-tokens.ts
// stores it). Locked rivals and cap overrides are undone in afterEach so a retry on the same DB starts clean.
// OFFER_SHOTS=<dir> also writes the U4 review screenshots (390 + 1280 wide); CI leaves it unset.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { Client } from 'pg';
import { ALREADY, ERRORS, FLOW, GUEST_LABEL } from '../../../src/content';
import { MANAGE_UI } from '../../../src/content/manage';
import { STALE } from '../../../src/content/ui/guest-after';
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

const made: string[] = [];
const capped: string[] = [];

interface Seed {
  dish?: string;
  mode?: 'slots' | 'dates';
  purpose?: 'take_offer' | 'pick_new_date';
  slotIds?: string[];
  ranges?: { starts_at: string; ends_at: string; where: string | null }[];
  expired?: boolean;
  status?: 'needs_new_time' | 'locked';
  lock?: { start: Date; end: Date };
}

async function seed(s: Seed = {}): Promise<{ requestId: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  return db(async (c) => {
    const inviteId = (await c.query<{ id: string }>(`select id from invite where token_secret = 'g3hx8q2v'`))
      .rows[0]!.id;
    const { rows } = await c.query<{ id: string }>(
      `with g as (insert into guest (email) values ($1) returning id)
       insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, counts_toward,
                            status, locked_starts_at, locked_ends_at, locked_where)
       select $2, g.id, $3, 'Sam Rivera', $1, $4, $5::request_mode, 'weekly_cap', $6::request_status, $7, $8, $9
         from g returning id`,
      [
        `s18-${randomUUID()}@example.com`,
        randomUUID(),
        inviteId,
        s.dish ?? 'the-long-lunch',
        s.mode ?? 'slots',
        s.status ?? 'needs_new_time',
        s.lock?.start ?? null,
        s.lock?.end ?? null,
        s.lock ? 'Tomahawk, North Van' : null,
      ],
    );
    const requestId = rows[0]!.id;
    made.push(requestId);
    if (s.status === 'locked') return { requestId, token };
    const offer = await c.query<{ id: string }>(
      `insert into offer (request_id, kind, slot_ids, ranges) values ($1, $2, $3::uuid[], $4::jsonb) returning id`,
      [
        requestId,
        s.purpose === 'pick_new_date' ? 'weather_call' : 'suggested_times',
        s.slotIds ?? [],
        JSON.stringify(s.ranges ?? []),
      ],
    );
    await c.query(
      `insert into action_token (token_hash, purpose, request_id, offer_id, expires_at)
       values ($1, $2, $3, $4, now() + $5::interval)`,
      [
        createHash('sha256').update(token, 'utf8').digest(),
        s.purpose ?? 'take_offer',
        requestId,
        offer.rows[0]!.id,
        s.expired ? '-1 day' : '30 days',
      ],
    );
    return { requestId, token };
  });
}

const slot = (date: string, w: 'lunch' | 'evening' = 'lunch') =>
  db(async (c) => {
    const { rows } = await c.query<{ id: string; starts_at: Date; ends_at: Date }>(
      `select id, starts_at, ends_at from slot where date = $1 and window_kind = $2`,
      [date, w],
    );
    return rows[0]!;
  });

const row = (id: string) =>
  db(
    async (c) =>
      (
        await c.query<{ status: string; awaiting_jon_since: Date | null; locked_where: string | null }>(
          `select status, awaiting_jon_since, locked_where from request where id = $1`,
          [id],
        )
      ).rows[0]!,
  );

const snapshot = (requestId: string) =>
  db(async (c) => {
    const parts = await Promise.all(
      ['request r where r.id', 'action_token r where r.request_id', 'offer r where r.request_id'].map((t) =>
        c.query(`select row_to_json(r)::text as j from ${t} = $1 order by 1`, [requestId]),
      ),
    );
    return JSON.stringify(parts.map((p) => p.rows));
  });

const offerUrl = (t: string) => `/offer?t=${encodeURIComponent(t)}`;
const newDateUrl = (t: string) => `/new-date?t=${encodeURIComponent(t)}`;

async function shot(page: Page, name: string) {
  const dir = process.env.OFFER_SHOTS;
  if (!dir) return;
  const size = page.viewportSize();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true });
  }
  if (size) await page.setViewportSize(size);
}

// Every test posts from 127.0.0.1: keep the per-IP offerTake limit (10/h) out of retries and --repeat-each.
test.beforeEach(() => db((c) => c.query(`delete from rate_limit where scope = 'offerTake'`)));
test.afterEach(() =>
  db(async (c) => {
    await c.query(
      `update request set status = 'cancelled', cancelled_at = now() where id = any($1::uuid[]) and status <> 'cancelled'`,
      [made.splice(0)],
    );
    await c.query(`update week set cap_override = null where week_start = any($1::date[])`, [
      capped.splice(0),
    ]);
  }),
);

test('N2: GET, HEAD and a link scanner prefetch of /offer and /new-date change nothing; one POST button', async ({
  page,
  request,
}) => {
  const may13 = await slot('2027-05-13');
  const s = await seed({ slotIds: [may13.id] });
  const n = await seed({ dish: 'the-encore', mode: 'dates', purpose: 'pick_new_date' });
  const before = [await snapshot(s.requestId), await snapshot(n.requestId)];
  for (const u of [offerUrl(s.token), newDateUrl(n.token)]) {
    expect((await request.head(u)).status()).toBe(200);
    const scan = await request.get(u, {
      headers: {
        'user-agent': 'Microsoft Office Protection',
        purpose: 'prefetch',
        'sec-purpose': 'prefetch',
      },
    });
    expect(scan.status()).toBe(200);
  }
  const res = await page.goto(offerUrl(s.token));
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    MANAGE_UI.heading(GUEST_LABEL.needs_new_time, 'The Long Lunch'),
  );
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.locator('main button[type=submit]')).toHaveCount(1);
  await shot(page, 'offer');
  await page.goto(newDateUrl(n.token));
  await expect(page.locator('[data-s18-form]')).toBeVisible();
  await expect(page.locator('main button[type=submit]')).toHaveCount(1);
  // QA H2: the grid is the season's months only (it opened on today's month before).
  const months = await page
    .locator('.cal-month')
    .evaluateAll((ms) => ms.map((m) => m.getAttribute('data-name')));
  expect(months.length).toBeGreaterThan(0);
  for (const m of months) expect(m).toMatch(/^(April|May|June) 2027$/);
  await shot(page, 'new-date');
  // Send with nothing picked: the inline line, no POST.
  await page.getByRole('button', { name: FLOW.send }).click();
  // Scoped to <main>: Next's #__next-route-announcer__ is a role=alert too.
  await expect(page.locator('main').getByRole('alert')).toHaveText(ERRORS.noTimes);
  expect([await snapshot(s.requestId), await snapshot(n.requestId)]).toEqual(before);
});

test('AC1: taking an offer twice acts once; the second visit shows "You’re locked in for Thu May 13"', async ({
  page,
}) => {
  const may13 = await slot('2027-05-13');
  const s = await seed({ slotIds: [may13.id] });
  await page.goto(offerUrl(s.token));
  await page.getByRole('radio').check();
  await page.getByRole('button', { name: FLOW.send }).click();
  await expect(page.getByRole('status')).toHaveText(/^You’re locked in for Thu May 13, /);
  expect((await row(s.requestId)).status).toBe('locked');
  // The same tap again from a stale tab: 200, the same line, nothing done twice.
  const again = await page.evaluate(
    async ({ token, slotId }) =>
      (
        await fetch('/api/offer/take', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, slotId, hp: '' }),
          referrerPolicy: 'strict-origin',
        })
      ).json(),
    { token: s.token, slotId: may13.id },
  );
  expect(again.message).toMatch(/^You’re locked in for Thu May 13, /);
  expect(
    await db(
      async (c) =>
        (
          await c.query(`select 1 from audit_log where request_id = $1 and action = 'offer_taken'`, [
            s.requestId,
          ])
        ).rowCount,
    ),
  ).toBe(1);
  await page.goto(offerUrl(s.token));
  await expect(page.locator('[data-s18-state=current] .s18-line')).toHaveText(
    ALREADY.lockedIn((again.message as string).slice('You’re locked in for '.length, -1)),
  );
  await expect(page.locator('main button[type=submit]')).toHaveCount(0);
  await shot(page, 'current');
});

test.describe('AC4', () => {
  // The spec'd 409 offer_gone is logged by the browser as a failed resource; the test asserts exactly that one error.
  test.use({ allowPageErrors: true });
  test('AC4: a suggested time taken after its week filled shows the fallback and sets awaiting_jon_since', async ({
    page,
    pageErrors,
  }) => {
    const full = await slot('2027-04-22');
    const open = await slot('2027-04-29');
    const s = await seed({ slotIds: [full.id, open.id] });
    // Fill the week of Apr 19: cap 1, and another guest locked on Apr 23.
    capped.push('2027-04-19');
    await db((c) => c.query(`update week set cap_override = 1 where week_start = '2027-04-19'`));
    const apr23 = await slot('2027-04-23');
    await seed({ status: 'locked', lock: { start: apr23.starts_at, end: apr23.ends_at } });
    await page.goto(offerUrl(s.token));
    await page.getByRole('radio', { name: /^Thu Apr 22, / }).check();
    const take = page.waitForResponse(
      (r) => r.url().endsWith('/api/offer/take') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: FLOW.send }).click();
    const res = await take;
    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: 'offer_gone' });
    await expect(page.locator('main').getByRole('alert')).toHaveText(ERRORS.offerGone);
    // Only the time still open is offered now.
    await expect(page.getByRole('radio')).toHaveCount(1);
    await expect(page.getByRole('radio', { name: /^Thu Apr 29, / })).toBeVisible();
    const r = await row(s.requestId);
    expect(r.status).toBe('needs_new_time');
    expect(r.awaiting_jon_since).not.toBeNull();
    expect(pageErrors).toHaveLength(1);
    expect(pageErrors[0]).toMatch(/\b409\b/);
  });
});

test('AC6: a dates-mode offer (the Encore, Sat Apr 3, 19:30–23:00) can be taken and auto-locks', async ({
  page,
}) => {
  // Not the TSD's May 22: collision-cap.spec leaks uncancelled locks into late weeks; it never picks Mar 29's week.
  // 19:30–23:00 Vancouver (PDT, UTC-7).
  const s = await seed({
    dish: 'the-encore',
    mode: 'dates',
    ranges: [
      { starts_at: '2027-04-04T02:30:00.000Z', ends_at: '2027-04-04T06:00:00.000Z', where: 'The Commodore' },
    ],
  });
  await page.goto(offerUrl(s.token));
  await expect(page.getByRole('radio', { name: /^Sat Apr 3, / })).toBeChecked();
  await page.getByRole('button', { name: FLOW.send }).click();
  await expect(page.getByRole('status')).toHaveText(/^You’re locked in for Sat Apr 3, /);
  expect(await row(s.requestId)).toMatchObject({ status: 'locked', locked_where: 'The Commodore' });
});

test('an expired link shows the "text me" page; a tampered one is a 404; a spent new-date link shows the state', async ({
  page,
  request,
}) => {
  const e = await seed({ slotIds: [(await slot('2027-05-13')).id], expired: true });
  expect((await page.goto(offerUrl(e.token)))?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(STALE.title);
  await expect(page.getByText(STALE.body)).toBeVisible();
  await shot(page, 'expired');
  const bad = `${e.token.slice(0, -2)}${e.token.endsWith('AA') ? 'BB' : 'AA'}`;
  expect((await request.get(offerUrl(bad))).status()).toBe(404);
  expect((await request.get(newDateUrl(bad))).status()).toBe(404);
  expect((await request.get('/offer')).status()).toBe(404);
  // A take_offer token is no pick_new_date link.
  expect((await request.get(newDateUrl(e.token))).status()).toBe(404);
  const n = await seed({ dish: 'the-encore', mode: 'dates', purpose: 'pick_new_date' });
  await db((c) =>
    c.query(`update request set status = 'cancelled', cancelled_at = now() where id = $1`, [n.requestId]),
  );
  await page.goto(newDateUrl(n.token));
  await expect(page.locator('[data-s18-state=current] .s18-line')).toHaveText(ALREADY.cancelled);
});
