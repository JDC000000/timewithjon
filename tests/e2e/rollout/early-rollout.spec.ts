// T4.3.06 (§12 early rollout, T0.5 AC8, T1.4): the admin moves the general release to March 1 while the personal
// release stays open (global-setup's OPEN_AT). Then a personal link books (picker tap -> Send -> Sent.) and the
// general link can't: its picker is the one line "Booking opens March 1.", its availability is `opensAt` with no
// windows, and a direct POST /api/requests gets 403 `not_released`. The release is restored in `finally`.
// Scope: 1440 at 100 % once per engine, first repeat only (it writes to the test DB and to the shared settings row).
// The two engines run it one at a time under a Postgres session lock (released with the connection, so a crashed
// run leaves no stale lock): one engine's restore can't open the general link under the other's checks.
import { randomUUID } from 'node:crypto';
import { request, type Page } from '@playwright/test';
import { Client } from 'pg';
import { AFTER_SEND, DISHES, FLOW } from '../../../src/content';
import { isBookable } from '../../../src/content/menu-helpers';
import { ROUTES } from '../../../src/ui/routes';
import { expect, test } from '../support/fixtures';
import { sendRequest } from '../support/flows';
import { clickLikeAPerson } from '../support/input';
import { inScope } from '../support/scope';
import { gotoScreen, TARGET } from '../support/screens';
import { adminSessionCookie } from '../support/sessions';

const SCOPE = { viewports: ['w1440'], textModes: ['t100'] } as const;
/** global-setup.ts: both releases open for the rest of the suite. */
const OPEN_AT = '2026-01-01T08:00:00Z';
/** The general release this case sets: March 1, 08:00 Vancouver (the season-table default). */
const GENERAL_AT = '2027-03-01T16:00:00Z';
/** The seeded general invite (supabase/seed.sql): its link's ?for= value. */
const GENERAL_INVITE_FOR = 'friends-g3hx8q2v';
const OPENS = 'Booking opens March 1.';
const PICKER_DISH = DISHES.find((d) => d.flow === 'picker' && isBookable(d))?.slug;

test.skip(
  ({ viewport, textMode }) => TARGET !== 'app' || !inScope(viewport, textMode, SCOPE),
  'T4.3.06 early rollout: app target, 1440 at 100 % (once per engine)',
);

type Windows = { weeks: { windows: unknown[] }[]; opensAt?: string };

test('T4.3.06 early rollout: a personal link books before Mar 1; the general link cannot', async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(test.info().repeatEachIndex > 0, 'it writes to the DB and the settings row: first repeat only');
  test.setTimeout(120_000);
  expect(PICKER_DISH, 'a bookable picker dish').toBeTruthy();
  expect(FLOW.opensOn('March 1')).toBe(OPENS);
  const engine = test.info().project.name.startsWith('webkit') ? 'webkit' : 'chromium';
  const origin = new URL(baseURL!).origin;
  const admin = adminSessionCookie();
  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: { origin, cookie: `${admin.name}=${admin.value}` },
  });
  const setRelease = (generalOpenAt: string) =>
    api.patch('/api/admin/settings', { data: { personalOpenAt: OPEN_AT, generalOpenAt } });
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(`select pg_advisory_lock(hashtext('twj_e2e_early_rollout'))`);
  const sideErrors: string[] = [];
  let general: Page | undefined;
  let restored = 0;
  try {
    await test.step('A7: the admin sets the general release to March 1; the personal one stays open', async () => {
      const res = await setRelease(GENERAL_AT);
      expect(res.status(), await res.text()).toBe(200);
      // The suite already spends the whole per-IP requestSend allowance (10/h, one bucket for every local caller:
      // send + journey + FOC-04): start this case's two POSTs from an empty bucket so a 429 can't stand in for
      // the answers checked below.
      await db.query(`delete from rate_limit where scope = 'requestSend'`);
    });

    await test.step('S6 -> S10: the personal link picks an open time and Sends (Sent.)', async () => {
      await gotoScreen(page, 's06-picker-open');
      const panel = page.getByRole('tabpanel');
      // Not the journey's tiles (0, 1): each engine books its own time.
      const tile = panel
        .getByRole('button', { pressed: false, disabled: false })
        .nth(engine === 'webkit' ? 3 : 2);
      await clickLikeAPerson(page, tile);
      await expect(panel.getByRole('button', { pressed: true })).toHaveCount(1);
      await sendRequest(page);
      expect(new URL(page.url()).pathname).toBe(ROUTES.sent);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(AFTER_SEND.stamp);
    });

    await test.step('the general link: its picker is "Booking opens March 1." with no times and no Send', async () => {
      general = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
      general.on('pageerror', (e) => sideErrors.push(e.message));
      await general.goto(`/?for=${GENERAL_INVITE_FOR}`);
      expect(
        (await general.context().cookies()).some((c) => c.name === 'twj_invite'),
        'the general link sets the invite cookie',
      ).toBe(true);
      await general.goto(`/book/${PICKER_DISH}`);
      await expect(general.getByText(OPENS, { exact: true })).toBeVisible();
      await expect(general.getByRole('tabpanel')).toHaveCount(0);
      await expect(general.getByRole('button', { name: /^Send$/ })).toHaveCount(0);
    });

    await test.step('T0.5 AC8: before its release the general availability is `opensAt` with no windows', async () => {
      const res = await general!.request.get(`/api/availability?dish=${PICKER_DISH}`);
      expect(res.status()).toBe(200);
      const out = (await res.json()) as Windows;
      expect(out.opensAt).toBe(new Date(GENERAL_AT).toISOString());
      expect(out.weeks.flatMap((w) => w.windows)).toHaveLength(0);
      // The personal invite, same moment: released, so no opensAt and open windows.
      const mine = (await (
        await page.request.get(`/api/availability?dish=${PICKER_DISH}`)
      ).json()) as Windows;
      expect(mine.opensAt).toBeUndefined();
      expect(mine.weeks.flatMap((w) => w.windows).length).toBeGreaterThan(0);
    });

    await test.step('T1.4: a direct POST /api/requests from the general link is refused (403 not_released)', async () => {
      const res = await general!.request.post('/api/requests', {
        headers: { origin },
        data: {
          clientKey: randomUUID(),
          dish: PICKER_DISH,
          name: `Early ${engine}`,
          email: `early-${engine}-${Date.now()}@example.com`,
          crew: 1,
          slotIds: [],
        },
      });
      expect(res.status()).toBe(403);
      expect(await res.json()).toMatchObject({ ok: false, code: 'not_released', message: OPENS });
    });
  } finally {
    restored = (await setRelease(OPEN_AT)).status();
    await general?.context().close();
    await api.dispose();
    await db.end(); // ends the session: the advisory lock goes with it
  }
  expect(restored, 'the general release is restored').toBe(200);
  expect(sideErrors, 'no page errors on the general link').toEqual([]);
});
