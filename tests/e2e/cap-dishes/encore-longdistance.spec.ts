// T4.3.04: The Encore uses the weekly cap; The Long Distance doesn't (technical scope §12, T0.5 AC11 + AC14).
// One week per engine: the guest requests The Encore and The Long Distance on dates in that week (real input on the
// date grid, The Long Distance with "Your time zone"); two Flat White lunch requests are seeded on the week's
// Thursday and Friday. The admin locks The Encore (the show date's week) and the Thursday lunch: the Friday lunch
// then needs the tick "Override this week: it would be the 3rd" (AC14: the Encore counted). The admin locks The Long
// Distance in that full week with no override tick, and the Friday lunch still reads "the 3rd" (AC11: not counted).
// Scope: 1440 at 100 % once per engine, first repeat only (it writes to the test DB). Each engine claims its own
// free week, latest first, under an advisory lock (the seeded Thursday/Friday choices are the claim), so the two
// engines never share a week and the journey's first open tiles (earliest weeks) stay clear.
// Each request is sent from a personal invite this test owns (pre-filled "Encore <tag>" / "Distance <tag>", T1.7.U2),
// not the shared seeded one, so A2 lists it under that name; afterEach deletes every row the test made.
import { randomUUID } from 'node:crypto';
import type { Browser, Page, Request } from '@playwright/test';
import { Client } from 'pg';
import { longDate } from '../../../src/app/book/[dish]/_lib/civil';
import { maskEmail, SEND_AS } from '../../../src/app/book/[dish]/_lib/prefill';
import { FLOW } from '../../../src/content';
import { LOCK, LOCK_SHEET, ordinal } from '../../../src/content/ui/admin-requests';
import { generateInviteSecret, signCookie } from '../../../src/features/invites/tokens';
import { ROUTES } from '../../../src/ui/routes';
import { BOOKED_WEEKS } from '../support/booked-weeks';
import { expect, test } from '../support/fixtures';
import { lockIn, TOAST_UNDO } from '../support/flows';
import { clickLikeAPerson } from '../support/input';
import { inScope } from '../support/scope';
import { TARGET } from '../support/screens';
import { signInAs } from '../support/sessions';

const SCOPE = { viewports: ['w1440'], textModes: ['t100'] } as const;
const OVERRIDE_3RD = LOCK.overrideWeek(ordinal(3));
const ANY_OVERRIDE = /^Override this week/;
const INVITE_COOKIE = 'twj_invite'; // src/features/invites/session.ts INVITE_COOKIE

test.skip(
  ({ viewport, textMode }) => TARGET !== 'app' || !inScope(viewport, textMode, SCOPE),
  'T4.3.04 cap dishes: app target, 1440 at 100 % (once per engine)',
);

async function db<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

type Week = { start: string; tue: string; wed: string; thuId: string; friId: string };
type Seeded = { week: Week; thu: { id: string; who: string }; fri: { id: string; who: string } };

/**
 * Claim a free week at the default cap and seed two requested weekly_cap Flat Whites on its Thursday and Friday
 * lunch slots. Free = no override on the cap, no away block, no offer, no lock anywhere near it, and no live
 * request choosing any of its slots (so a parallel run of this spec, which claims weeks the same way, skips it; a
 * cancelled request's leftovers don't count, so weeks other specs have given back are reused).
 */
const claimWeek = (tag: string) =>
  db(async (c): Promise<Seeded> => {
    await c.query('begin');
    try {
      await c.query(`select pg_advisory_xact_lock(hashtext('twj_e2e_cap_dishes'))`);
      const {
        rows: [w],
      } = await c.query<{ start: string; tue: string; wed: string; thu_id: string; fri_id: string }>(
        `with lunch as (select s.id, s.date from slot s where s.window_kind = 'lunch')
         select to_char(w.week_start, 'YYYY-MM-DD') as start,
                to_char(w.week_start + 1, 'YYYY-MM-DD') as tue,
                to_char(w.week_start + 2, 'YYYY-MM-DD') as wed,
                (select l.id from lunch l where l.date = w.week_start + 3 order by l.id limit 1) as thu_id,
                (select l.id from lunch l where l.date = w.week_start + 4 order by l.id limit 1) as fri_id
           from week w
          where w.week_start >= '2027-01-01' and w.cap_override is null and w.week_start <> all($1::date[])
            and exists (select 1 from lunch l where l.date = w.week_start + 3)
            and exists (select 1 from lunch l where l.date = w.week_start + 4)
            and not exists (select 1 from request_slot_choice x join slot s on s.id = x.slot_id
                             join request xr on xr.id = x.request_id and xr.status <> 'cancelled'
                             where s.date between w.week_start and w.week_start + 6)
            and not exists (select 1 from offer o join slot s on s.id = any(o.slot_ids) or s.id = o.taken_slot_id
                             join request orq on orq.id = o.request_id and orq.status <> 'cancelled'
                             where s.date between w.week_start and w.week_start + 6)
            and not exists (select 1 from availability_block b
                             where b.start_date <= w.week_start + 6 and b.end_date >= w.week_start)
            and not exists (select 1 from request r where r.status = 'locked'
                              and r.locked_starts_at::date between w.week_start - 1 and w.week_start + 7)
          order by w.week_start desc limit 1`,
        [BOOKED_WEEKS],
      );
      if (!w) throw new Error('no free 2027 week in the test DB');
      const seed = async (slotId: string, who: string) => {
        const email = `cap-${randomUUID()}@example.com`;
        const {
          rows: [r],
        } = await c.query<{ id: string }>(
          `with g as (insert into guest (email) values ($1) returning id)
           insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode,
                                counts_toward, status)
           select $2, g.id, (select id from invite where token_secret = 'g3hx8q2v'), $3, $1,
                  'the-flat-white', 'slots', 'weekly_cap', 'requested'
             from g returning id`,
          [email, randomUUID(), who],
        );
        await c.query(`insert into request_slot_choice (request_id, slot_id) values ($1, $2)`, [
          r!.id,
          slotId,
        ]);
        own.requests.push(r!.id);
        own.emails.push(email);
        return { id: r!.id, who };
      };
      const thu = await seed(w.thu_id, `Cap Thu ${tag}`);
      const fri = await seed(w.fri_id, `Cap Fri ${tag}`);
      await c.query('commit');
      return { week: { start: w.start, tue: w.tue, wed: w.wed, thuId: w.thu_id, friId: w.fri_id }, thu, fri };
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
  });

type Guest = { inviteId: string; name: string; email: string };

/** Rows this test made (its invites, its seeded lunches, their guests' emails); afterEach deletes them. */
const own = { invites: [] as string[], requests: [] as string[], emails: [] as string[] };

/** A personal invite of this test's own, pre-filled with `name` and a fresh email (T1.7.U2 "Sending as"). */
async function ownInvite(name: string, key: string): Promise<Guest> {
  const secret = generateInviteSecret();
  const email = `${key}-${randomUUID()}@example.com`;
  const inviteId = await db(async (c) => {
    const {
      rows: [row],
    } = await c.query<{ id: string }>(
      `insert into invite (kind, token_secret, name_slug, display_name, prefill_name, prefill_email, is_test)
       values ('personal', $1, $2, $3, $3, $4, true) returning id`,
      [secret, `e2e-${key}-${secret}`, name, email],
    );
    return row!.id;
  });
  own.invites.push(inviteId);
  own.emails.push(email);
  return { inviteId, name, email };
}

/** Arrive as `guest`: the signed twj_invite cookie their invite link sets. */
async function actAs(page: Page, baseURL: string, guest: Guest): Promise<void> {
  const value = signCookie('invite', guest.inviteId, 3600, process.env.SESSION_SIGNING_SECRET!);
  await page.context().addCookies([{ name: INVITE_COOKIE, value, url: baseURL }]);
}

test.afterEach(async () => {
  const { invites, requests, emails } = own;
  own.invites = [];
  own.requests = [];
  own.emails = [];
  if (!invites.length && !requests.length) return;
  await db(async (c) => {
    await c.query('begin');
    try {
      await c.query(`delete from request where invite_id = any($1::uuid[]) or id = any($2::uuid[])`, [
        invites,
        requests,
      ]);
      await c.query(
        `delete from guest g where g.email = any($1::citext[])
           and not exists (select 1 from request r where r.guest_id = g.id)`,
        [emails],
      );
      await c.query(`delete from invite where id = any($1::uuid[])`, [invites]);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
  });
});

/**
 * WebKit reports an aborted Next.js RSC prefetch as "<url>?_rsc=<id> due to access control checks." Same pattern
 * as `WEBKIT_RSC_ABORT` in ../support/fixtures (#119, cc5be60); import it from there once #119 is on main.
 */
const WEBKIT_RSC_ABORT =
  /^(?:Fetch API cannot load )?(?:https?:)?\/{0,2}(?:127\.0\.0\.1|localhost):\d+\/[^\s?]*\?_rsc=[\w-]+ due to access control checks\.$/;
const RSC_URL = /[?&]_rsc=/;

/**
 * A second browser context for the admin, with its own page-error watch (the fixture watches `page` only).
 * On WebKit only, two kinds of message are prefetch noise, not app errors: the RSC abort line above, and a bare
 * "Load failed" (the TypeError of that aborted fetch), which is dropped only when a `?_rsc=` request on this
 * page actually failed, one per failed request. Chromium and every other message are kept as-is.
 * `errors()` returns the list; call it before closing the context (teardown aborts prefetches).
 */
async function sidePage(browser: Browser): Promise<{ page: Page; errors: () => string[] }> {
  const webkit = browser.browserType().name() === 'webkit';
  const side = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const raw: string[] = [];
  let rscFailed = 0;
  side.on('pageerror', (e) => {
    if (!(webkit && WEBKIT_RSC_ABORT.test(e.message))) raw.push(e.message);
  });
  side.on('requestfailed', (r) => {
    if (webkit && RSC_URL.test(r.url())) rscFailed += 1;
  });
  const errors = (): string[] => {
    let budget = rscFailed;
    return raw.filter((m) => {
      if (!(webkit && m === 'Load failed' && budget > 0)) return true;
      budget -= 1;
      return false;
    });
  };
  return { page: side, errors };
}

/**
 * S7: tap one day on the date grid (Next month until its month shows), then Send as the invite's pre-filled guest:
 * the details step is the one "Sending as <name> · <email>" line, with no name or email field (T1.7.U2).
 */
async function requestDate(page: Page, dish: string, date: string, guest: Guest): Promise<void> {
  await page.goto(`/book/${dish}`);
  const [, , d] = date.split('-');
  const day = page.getByRole('button', { name: `${Number(d)}, ${longDate(date)}`, exact: true });
  const next = page.getByRole('button', { name: 'Next month' });
  for (let i = 0; i < 4 && !(await day.isVisible()); i++) await clickLikeAPerson(page, next);
  await clickLikeAPerson(page, day);
  await expect(day).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sendas')).toContainText(
    `${SEND_AS.lead} ${guest.name} · ${maskEmail(guest.email)}`,
  );
  await expect(page.getByRole('textbox', { name: /^Your (name|email)/ })).toHaveCount(0);
  await clickLikeAPerson(page, page.getByRole('button', { name: /^Send$/ }));
  await page.waitForURL((u) => u.pathname === ROUTES.sent);
}

/**
 * After a lock lands, the page shows "Sent" and then re-reads itself (router.refresh, a non-prefetch `?_rsc=` GET).
 * Leaving before that re-read finishes aborts its fetch; Next answers the failed fetch with a hard load of this same
 * page, which interrupts the next `goto` (WebKit, main CI 36650096614: "page.goto … is interrupted by another
 * navigation"). Arm on the request page before the lock; await it after "Sent", before going anywhere else.
 * The re-read counts as done on `requestfinished`, or on `requestfailed` that already carries a 200 response: Chromium
 * reports every completed RSC fetch as net::ERR_ABORTED after its 200 (CI 36651667235 trace), so it never emits
 * `requestfinished`. A failure with no response is the real abort above and does not count.
 */
function lockRefreshDone(admin: Page): Promise<unknown> {
  const path = new URL(admin.url()).pathname;
  const isRefresh = (r: Request) =>
    RSC_URL.test(r.url()) && new URL(r.url()).pathname === path && !r.headers()['next-router-prefetch'];
  const finished = admin.waitForEvent('requestfinished', { predicate: isRefresh, timeout: 30_000 });
  const answered = admin.waitForEvent('requestfailed', {
    predicate: async (r) => isRefresh(r) && (await r.response())?.status() === 200,
    timeout: 30_000,
  });
  // The losing waiter times out later; the caller awaits `done`. These only keep stray rejections handled.
  finished.catch(() => {});
  answered.catch(() => {});
  const done = Promise.race([finished, answered]);
  done.catch(() => {});
  return done;
}

/** A3 dates mode: Lock in opens the Lock sheet (no override tick there); its commit starts the undo window. */
async function lockDated(admin: Page, who: string, dishShort: string): Promise<void> {
  await admin.goto(ROUTES.admin.requests);
  await clickLikeAPerson(admin, admin.getByRole('link', { name: new RegExp(who) }));
  await admin.waitForURL(/\/admin\/requests\/[^/]+$/);
  const refreshed = lockRefreshDone(admin);
  await clickLikeAPerson(admin, admin.getByRole('button', { name: /^Lock in/ }));
  const sheet = admin.getByRole('dialog', { name: LOCK_SHEET.title(who, dishShort) });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('checkbox', { name: ANY_OVERRIDE })).toHaveCount(0);
  await clickLikeAPerson(admin, sheet.getByRole('button', { name: /^Lock in / }));
  await expect(admin.getByRole('button', TOAST_UNDO)).toBeVisible();
  await expect(admin.getByRole('status').filter({ hasText: LOCK.sent })).toBeVisible({ timeout: 20_000 });
  await refreshed;
}

test('T4.3.04: The Encore counts toward its week’s cap; The Long Distance never does', async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(test.info().repeatEachIndex > 0, 'writes to the DB: first repeat only');
  test.setTimeout(180_000);
  const engine = test.info().project.name.startsWith('webkit') ? 'Webkit' : 'Chromium';
  const tag = `${engine} ${Date.now().toString(36)}`;
  const encore = await ownInvite(`Encore ${tag}`, 'encore');
  const distance = await ownInvite(`Distance ${tag}`, 'distance');
  const seeded = await claimWeek(tag);
  const { week } = seeded;

  await test.step('S7: the guest asks for The Encore on the week’s Tuesday', async () => {
    await actAs(page, baseURL!, encore);
    await requestDate(page, 'the-encore', week.tue, encore);
  });

  await test.step('S7: the guest asks for The Long Distance on the Wednesday, with "Your time zone"', async () => {
    await actAs(page, baseURL!, distance);
    await page.goto('/book/the-long-distance');
    const zone = page.getByRole('combobox', { name: FLOW.timeZoneLabel });
    await expect(zone).toBeVisible();
    await expect(zone).not.toHaveValue('');
    await requestDate(page, 'the-long-distance', week.wed, distance);
  });

  const { page: admin, errors: sideErrors } = await sidePage(browser);
  await signInAs(admin.context(), 'admin', baseURL!);
  const openSeeded = async (id: string) => {
    await admin.goto(`${ROUTES.admin.requestsPrefix}/${id}`);
    await expect(admin.getByRole('button', { name: /^Lock in/ })).toBeVisible();
  };

  await test.step('A3: lock The Encore, then the Thursday lunch (the 2nd of the week: no tick)', async () => {
    await lockDated(admin, encore.name, 'Encore');
    await openSeeded(seeded.thu.id);
    await expect(admin.getByRole('checkbox', { name: ANY_OVERRIDE })).toHaveCount(0);
    const refreshed = lockRefreshDone(admin);
    await lockIn(admin);
    await expect(admin.getByRole('status').filter({ hasText: LOCK.sent })).toBeVisible({ timeout: 20_000 });
    await refreshed;
  });

  await test.step('AC14: the Friday lunch would be the 3rd, so Lock in waits for the override tick', async () => {
    await openSeeded(seeded.fri.id);
    const tick = admin.getByRole('checkbox', { name: OVERRIDE_3RD });
    await expect(tick).toBeVisible();
    await expect(tick).not.toBeChecked();
    const lock = admin.getByRole('button', { name: /^Lock in/ });
    await expect(lock).toBeDisabled();
    await clickLikeAPerson(admin, tick);
    await expect(tick).toBeChecked();
    await expect(lock).toBeEnabled();
  });

  await test.step('AC11: The Long Distance locks in the full week with no override tick', async () => {
    await lockDated(admin, distance.name, 'Long Distance');
  });

  await test.step('AC11: the Friday lunch still reads "the 3rd": The Long Distance did not count', async () => {
    await openSeeded(seeded.fri.id);
    await expect(admin.getByRole('checkbox', { name: OVERRIDE_3RD })).toBeVisible();
  });

  // Check before teardown: closing the context aborts in-flight prefetches, which are not app errors.
  expect(sideErrors(), 'admin page errors').toEqual([]);
  await admin.context().close();
});
