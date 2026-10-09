// T4.3.03: a collision and the hidden weekly cap, end to end (T2.3 AC1 + AC3, T0.5 AC12).
// 1. Two admin browsers lock two requests for the SAME window at the same moment: exactly one lands, the other
//    reads "That time just went." (the 409 time_taken, src/features/availability/canLock.ts REFUSAL_MESSAGE).
// 2. Two weekly_cap requests are locked in one week (the default cap is 2); a 3rd in that week shows the
//    "Override this week: it would be the 3rd" tick, Lock in stays off unticked and the server refuses it (409
//    week_full); ticked, the lock lands.
// 3. The guest's picker, with that week full, carries no cap / count / remaining: not in the DOM text, not as a key
//    in any response it loads (T0.5 AC12).
// Seeds its own requests in the loopback test DB (as tests/e2e/admin/lock-leave does): two whole free 2027 weeks per
// engine, picked under an advisory lock so parallel workers never share a week. A week is free when nothing LIVE is
// on it (a cancelled request's choices and offers don't count), and every spec that seeds a week this way cancels
// its requests when it ends, so the weeks are reused within a run instead of running out by the last project. Scope: 1440 at 100 %, once per
// engine, first repeat only (the journey/journey.spec.ts SCOPE pattern).
import { randomUUID } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { Client } from 'pg';
import { LOCK, ordinal } from '../../../src/content/ui/admin-requests';
import { ROUTES } from '../../../src/ui/routes';
import { BOOKED_WEEKS } from '../support/booked-weeks';
import { expect, test } from '../support/fixtures';
import { lockIn } from '../support/flows';
import { lockAnswered, lockInAndLand, watchLock, type LockWatch } from '../support/lock-landing';
import { clickLikeAPerson } from '../support/input';
import { inScope } from '../support/scope';
import { gotoScreen, TARGET } from '../support/screens';
import { signInAs } from '../support/sessions';

const SCOPE = { viewports: ['w1440'], textModes: ['t100'] } as const;
const TIME_TAKEN = 'That time just went.'; // REFUSAL_MESSAGE.time_taken (canLock.ts)
/** T0.5 AC12: no key named cap / count / remaining in anything the guest loads. */
const CAP_KEY = /"(cap|count|remaining)"\s*:/i;
const CAP_WORD = /\b(cap|count|remaining)\b/i;

test.skip(
  ({ viewport, textMode }) => TARGET !== 'app' || !inScope(viewport, textMode, SCOPE),
  'T4.3.03 collision + cap: app target, 1440 at 100 % (once per engine)',
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

type Seeded = { collision: [string, string]; capped: [string, string, string]; capSlot: string };

/**
 * Two whole Thu/Fri weeks with nothing on them (no chosen time, no lock, block or offer; lunch + evening on both
 * days), newest first so the picker-driven journey (the first open tiles) never lands on them.
 * Week A: two uncapped flat-white requests for the one Thursday lunch (the collision).
 * Week B: three weekly_cap Old Haunt requests, one per window (Thu lunch, Thu evening, Fri lunch).
 */
const seed = () =>
  db(async (c) => {
    await c.query('begin');
    try {
      await c.query(`select pg_advisory_xact_lock(hashtext('twj_e2e_collision_cap'))`);
      const { rows: weeks } = await c.query<{ week_start: string; slots: Record<string, string> }>(
        `with ws as (select date_trunc('week', s.date)::date as week_start, s.id, s.date, s.window_kind
                        from slot s where s.date >= '2027-01-01' and s.date <> '2027-04-01'
                          and date_trunc('week', s.date)::date <> all($1::date[]))
         select ws.week_start::text, jsonb_object_agg(to_char(ws.date, 'Dy') || '-' || ws.window_kind, ws.id) as slots
           from ws left join week w on w.week_start = ws.week_start
          where coalesce(w.cap_override, (select default_weekly_cap from settings limit 1)) = 2
          group by ws.week_start
         having count(*) = 4
            and not exists (select 1 from ws s2 join request_slot_choice x on x.slot_id = s2.id
                             join request xr on xr.id = x.request_id and xr.status <> 'cancelled'
                             where s2.week_start = ws.week_start)
            and not exists (select 1 from offer o join request orq on orq.id = o.request_id, ws s2
                             where s2.week_start = ws.week_start and orq.status <> 'cancelled'
                               and (s2.id = any(o.slot_ids) or o.taken_slot_id = s2.id))
            and not exists (select 1 from availability_block b
                             where b.start_date <= ws.week_start + 6 and b.end_date >= ws.week_start)
            and not exists (select 1 from request r where r.status in ('locked', 'done')
                              and r.locked_starts_at::date between ws.week_start - 1 and ws.week_start + 8)
          order by ws.week_start desc limit 2`,
        [BOOKED_WEEKS],
      );
      const [a, b] = weeks;
      if (!a || !b) throw new Error('no two free 2027 weeks in the test DB');
      const add = async (dish: string, countsToward: string, slotId: string) => {
        const email = `t4303-${randomUUID()}@example.com`;
        const {
          rows: [req],
        } = await c.query<{ id: string }>(
          `with g as (insert into guest (email) values ($1) returning id)
           insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode,
                                counts_toward, status)
           select $2, g.id, (select id from invite where token_secret = 'g3hx8q2v'), $3, $1, $4, 'slots', $5,
                  'requested'
             from g returning id`,
          [email, randomUUID(), `Cap ${randomUUID().slice(0, 8)}`, dish, countsToward],
        );
        await c.query(`insert into request_slot_choice (request_id, slot_id) values ($1, $2)`, [
          req!.id,
          slotId,
        ]);
        return req!.id;
      };
      const out: Seeded = {
        collision: [
          await add('the-flat-white', 'none', a.slots['Thu-lunch']!),
          await add('the-flat-white', 'none', a.slots['Thu-lunch']!),
        ],
        capped: [
          await add('the-old-haunt', 'weekly_cap', b.slots['Thu-lunch']!),
          await add('the-old-haunt', 'weekly_cap', b.slots['Thu-evening']!),
          await add('the-old-haunt', 'weekly_cap', b.slots['Fri-lunch']!),
        ],
        capSlot: b.slots['Fri-lunch']!,
      };
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
  });

// Its locks fill two weeks; they are given back when the test ends (cancelled: no longer locked, choices ignored).
const seeded: string[] = [];
test.afterEach(() =>
  db((c) =>
    c.query(`update request set status = 'cancelled', cancelled_at = now() where id = any($1::uuid[])`, [
      seeded.splice(0),
    ]),
  ),
);

const statuses = (ids: string[]) =>
  db(async (c) =>
    (
      await c.query<{ status: string }>(`select status from request where id = any($1) order by id`, [ids])
    ).rows.map((r) => r.status),
  );

/** An admin browser of its own (the fixture's `page` stays the guest), with its own page-error watch. */
async function adminPage(browser: Browser, baseURL: string, errors: string[], id: string): Promise<Page> {
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  admin.on('pageerror', (e) => errors.push(e.message));
  await signInAs(admin.context(), 'admin', baseURL);
  expect((await admin.goto(`${ROUTES.admin.requestsPrefix}/${id}`))?.status()).toBe(200);
  return admin;
}

const lockButton = (p: Page) => p.getByRole('button', { name: /^Lock in/ });
const sent = (p: Page) => p.getByRole('status').filter({ hasText: LOCK.sent });

test('T4.3.03: a collision, then the hidden cap (3rd lock blocked, override works, no counts for the guest)', async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(test.info().repeatEachIndex > 0, 'writes to the DB: first repeat only');
  test.setTimeout(150_000);
  const s = await seed();
  seeded.push(...s.collision, ...s.capped);
  const sideErrors: string[] = [];

  await test.step('Collision: two admins lock the same window at once; exactly one lands', async () => {
    const [one, two] = await Promise.all(
      s.collision.map((id) => adminPage(browser, baseURL!, sideErrors, id)),
    );
    await Promise.all([one!, two!].map((p) => expect(lockButton(p)).toBeEnabled()));
    const watches = [one!, two!].map((p) => watchLock(p));
    await Promise.all([one!, two!].map((p) => lockIn(p)));
    // Both undo windows run out; the two POSTs race (each phase within its own bound: support/lock-landing.ts).
    // One answers 200 and reads "Locked in. Invite sent.", the other 409 and the time-taken line.
    const outcome = async (p: Page, watch: LockWatch) => {
      const res = await lockAnswered(p, test.info(), watch);
      const won = sent(p);
      const lost = p.getByRole('alert').filter({ hasText: TIME_TAKEN });
      await expect(won.or(lost)).toBeVisible();
      const result = (await won.count()) > 0 ? 'locked' : 'refused';
      expect(res.status(), `POST /lock answer for the ${result} side`).toBe(result === 'locked' ? 200 : 409);
      return result;
    };
    const results = await Promise.all([outcome(one!, watches[0]!), outcome(two!, watches[1]!)]);
    expect(results.sort()).toEqual(['locked', 'refused']);
    expect((await statuses(s.collision)).sort()).toEqual(['locked', 'requested']);
    await Promise.all([one!, two!].map((p) => p.context().close()));
  });

  await test.step('Cap: lock two weekly_cap requests in one week', async () => {
    for (const id of s.capped.slice(0, 2)) {
      const admin = await adminPage(browser, baseURL!, sideErrors, id);
      await lockInAndLand(admin, test.info());
      await admin.context().close();
    }
    expect(await statuses(s.capped.slice(0, 2))).toEqual(['locked', 'locked']);
  });

  await test.step('Cap: the 3rd shows the override tick; unticked, Lock in is off and the server refuses it', async () => {
    const id = s.capped[2];
    const admin = await adminPage(browser, baseURL!, sideErrors, id);
    const tick = admin.getByRole('checkbox', { name: LOCK.overrideWeek(ordinal(3)) });
    await expect(tick).toBeVisible();
    await expect(tick).not.toBeChecked();
    await expect(lockButton(admin)).toBeDisabled();
    // The server's own gate (T2.3 AC3), not just the disabled button: the same POST the pane sends, unticked.
    const res = await admin.request.post(`/api/admin/requests/${id}/lock`, {
      data: { slotId: s.capSlot },
      headers: { origin: new URL(baseURL!).origin },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: 'week_full' });
    expect(await statuses([id])).toEqual(['requested']);

    await test.step('Tick Override this week: the lock lands', async () => {
      await clickLikeAPerson(admin, tick);
      await expect(tick).toBeChecked();
      await lockInAndLand(admin, test.info());
      expect(await statuses([id])).toEqual(['locked']);
    });
    await admin.context().close();
  });

  await test.step('Guest: the picker carries no cap / count / remaining (DOM or responses)', async () => {
    const bodies: Promise<string>[] = [];
    page.on('response', (r) => {
      const type = r.headers()['content-type'] ?? '';
      if (r.url().startsWith(baseURL!) && /json|x-component|html/.test(type))
        bodies.push(r.text().catch(() => ''));
    });
    await gotoScreen(page, 's06-picker-open');
    await expect(page.getByRole('tabpanel')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await page.locator('body').innerText()).not.toMatch(CAP_WORD);
    const texts = await Promise.all(bodies);
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).not.toMatch(CAP_KEY);
  });

  expect(sideErrors, 'admin page errors').toEqual([]);
});
