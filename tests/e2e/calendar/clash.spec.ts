// T4.3.05 (T3.5 AC1, AC3): an event on Jon's main calendar hides that window, and nothing is ever written to it.
// The prototype's free/busy is the mock fixture (src/lib/adapters/mock/freebusy.ts, not the 10-min live poll):
// Thu 2027-04-15 12:30-13:30 hides that lunch, Fri 2027-05-21 18:00-23:00 hides that evening. The mock calendar
// resolves each write's target like the real adapter (stored target + assertWritableCalendar) and logs the RESOLVED
// calendarId, method and outcome to test-results/mock-calendar-log.jsonl (src/lib/adapters/mock/calendar.ts); a
// `primary` target is logged as 'refused' (negative control: src/lib/adapters/__tests__/mock-calendar.test.ts).
// After the admin locks a booking in, the log holds its one written insert and no write names `primary`.
// Scope: 1440 at 100 % once per engine, first repeat only: the lock writes to the test DB, so each engine books its
// own June week (chromium the last open tile, webkit the first) under its own guest name and email.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { AFTER_SEND } from '../../../src/content';
import { ROUTES } from '../../../src/ui/routes';
import { expect, test } from '../support/fixtures';
import { lockInAndLand } from '../support/lock-landing';
import { clickLikeAPerson, press, settle } from '../support/input';
import { inScope } from '../support/scope';
import { TARGET } from '../support/screens';
import { signInAs } from '../support/sessions';

const SCOPE = { viewports: ['w1440'], textModes: ['t100'] } as const;
const LOG_FILE = path.join('test-results', 'mock-calendar-log.jsonl');
const LUNCH = '/book/the-flat-white';
const EVENING = '/book/the-first-round';

type Call = { calendarId: string; method: string; outcome: string; eventId: string; requestId?: string };

test.skip(
  ({ viewport, textMode }) => TARGET !== 'app' || !inScope(viewport, textMode, SCOPE),
  'T4.3.05 clash: app target, 1440 at 100 % (once per engine)',
);

function calls(): Call[] {
  if (!existsSync(LOG_FILE)) return [];
  return readFileSync(LOG_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Call);
}

/** The picker's week row for a Thu–Fri pair, after showing its month tab with a real click. */
async function week(page: Page, month: RegExp, caption: string) {
  await clickLikeAPerson(page, page.getByRole('tab', { name: month }));
  const panel = page.getByRole('tabpanel');
  await expect(panel).toBeVisible();
  return panel.getByRole('group', { name: caption, exact: true });
}

test('T4.3.05 clash: a main-calendar event hides its window', async ({ page, baseURL }) => {
  await signInAs(page.context(), 'guest', baseURL!);

  await test.step('Thu Apr 15 lunch is hidden; Fri Apr 16 lunch stays', async () => {
    await page.goto(LUNCH);
    const row = await week(page, /^Apr/, 'Apr 15–16');
    await expect(row.getByRole('button', { name: /^Fri/ })).toHaveCount(1);
    await expect(row.getByRole('button', { name: /^Thu/ })).toHaveCount(0);
  });

  await test.step('Fri May 21 evening is hidden; Thu May 20 evening stays', async () => {
    await page.goto(EVENING);
    const row = await week(page, /^May/, 'May 20–21');
    await expect(row.getByRole('button', { name: /^Thu/ })).toHaveCount(1);
    await expect(row.getByRole('button', { name: /^Fri/ })).toHaveCount(0);
  });
});

test('T4.3.05 clash: a lock-in inserts on the app calendar, never on primary', async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(test.info().repeatEachIndex > 0, 'the lock writes to the DB: first repeat only');
  test.setTimeout(120_000);
  const engine = test.info().project.name.startsWith('webkit') ? 'webkit' : 'chromium';
  const guestName = `Clash ${engine === 'webkit' ? 'Webkit' : 'Chromium'} ${Date.now().toString(36)}`;
  const guestEmail = `clash-${engine}-${Date.now()}@example.com`;
  let requestId = '';

  await test.step('the guest picks a June lunch and sends', async () => {
    await signInAs(page.context(), 'guest', baseURL!);
    await page.goto(LUNCH);
    await clickLikeAPerson(page, page.getByRole('tab', { name: /^Jun/ }));
    const open = page.getByRole('tabpanel').getByRole('button', { pressed: false, disabled: false });
    await clickLikeAPerson(page, engine === 'webkit' ? open.first() : open.last());
    // T1.7.U2: the personal invite's details sit behind "Sending as … · Change"; open them so this run's own name
    // and email are sent (the admin row is found by that name).
    const change = page.getByRole('button', { name: 'Change', exact: true });
    await expect(change.or(page.getByRole('textbox', { name: /^Your name/ })).first()).toBeVisible();
    if (await change.count()) await clickLikeAPerson(page, change);
    for (const [label, value] of [
      [/^Your name/, guestName],
      [/^Your email/, guestEmail],
    ] as const) {
      const field = page.getByRole('textbox', { name: label });
      if (!(await field.count())) continue;
      await clickLikeAPerson(page, field);
      await press(page, 'ControlOrMeta+a');
      await page.keyboard.type(value, { delay: 5 });
      await settle(page);
    }
    await clickLikeAPerson(page, page.getByRole('button', { name: /^Send$/ }));
    await page.waitForURL((next) => next.pathname === ROUTES.sent);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(AFTER_SEND.stamp);
  });

  await test.step('the admin locks it in; the undo window runs out', async () => {
    const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const errors: string[] = [];
    admin.on('pageerror', (e) => errors.push(e.message));
    await signInAs(admin.context(), 'admin', baseURL!);
    await admin.goto(ROUTES.admin.requests);
    await clickLikeAPerson(admin, admin.getByRole('link', { name: new RegExp(guestName) }));
    await admin.waitForURL(/\/admin\/requests\/[^/]+$/);
    requestId = new URL(admin.url()).pathname.split('/').pop()!;
    await lockInAndLand(admin, test.info()); // the undo window and the round trip, each within its own bound
    await admin.context().close();
    expect(errors, 'admin page errors').toEqual([]);
  });

  await test.step('the mock log has the insert, and no write names primary', async () => {
    await expect
      .poll(() => calls().filter((c) => c.method === 'insert' && c.requestId === requestId).length, {
        message: `a mock insert for request ${requestId} in ${LOG_FILE}`,
        timeout: 15_000,
      })
      .toBe(1);
    const all = calls();
    const insert = all.find((c) => c.method === 'insert' && c.requestId === requestId);
    expect(insert, 'the lock-in insert went through the write guard').toMatchObject({ outcome: 'written' });
    expect(insert?.calendarId).toMatch(/@group\.calendar\.google\.com$/);
    expect(all.filter((c) => c.calendarId.toLowerCase() === 'primary')).toEqual([]);
    expect(all.filter((c) => c.outcome !== 'written')).toEqual([]);
    expect(all.every((c) => /@group\.calendar\.google\.com$/.test(c.calendarId))).toBe(true);
  });
});
