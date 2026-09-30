// T4.3.02: the mock-mode journey, end to end in a real browser with real input only (pointer + keyboard):
// the guest's invite -> picker taps -> Send -> story + photo on S11 -> the admin locks it in on A3 -> the E4 invite
// email lands in /dev/outbox with its manage link. The steps after that (S17 manage -> cancel -> the window
// reopens -> the stand-by offer) are test.fixme until the /manage and /offer pages land on main (owner U4).
// Scope: 1440 at 100 % once per engine, first repeat only: the journey writes to the test DB, so each engine
// books its own time (chromium the first open tile, webkit the second) under its own guest name and email.
import type { Browser, Locator, Page } from '@playwright/test';
import { AFTER_SEND } from '../../../src/content';
import { PHOTO_PICKER, STORY_FORM } from '../../../src/content/ui/guest-after';
import { ROUTES } from '../../../src/ui/routes';
import { expect, test } from '../support/fixtures';
import { lockInAndLand } from '../support/lock-landing';
import { clickLikeAPerson, press, settle, typeLikeAPerson } from '../support/input';
import { inScope } from '../support/scope';
import { gotoScreen, TARGET } from '../support/screens';
import { signInAs } from '../support/sessions';

const SCOPE = { viewports: ['w1440'], textModes: ['t100'] } as const;
const MANAGE_PAGES =
  'S17 manage page / S18 offer page not on main (owner U4): only /api/manage/* and /api/offer/*';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.skip(
  ({ viewport, textMode }) => TARGET !== 'app' || !inScope(viewport, textMode, SCOPE),
  'T4.3.02 journey: app target, 1440 at 100 % (once per engine)',
);

/** Replace a field's value like a person: click in, select all, type. */
async function retype(page: Page, field: Locator, text: string): Promise<void> {
  await clickLikeAPerson(page, field);
  await press(page, 'ControlOrMeta+a');
  await page.keyboard.type(text, { delay: 5 });
  await settle(page);
}

/** A second browser context for the admin or /dev, with its own page-error watch (the fixture watches `page`). */
async function sidePage(browser: Browser, errors: string[]): Promise<Page> {
  const side = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  side.on('pageerror', (e) => errors.push(e.message));
  return side;
}

test('T4.3.02 journey: invite -> taps -> Send -> story + photo -> lock -> E4 in /dev/outbox', async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(test.info().repeatEachIndex > 0, 'the journey writes to the DB: first repeat only');
  test.setTimeout(150_000);
  const engine = test.info().project.name.startsWith('webkit') ? 'webkit' : 'chromium';
  const guestName = `Journey ${engine === 'webkit' ? 'Webkit' : 'Chromium'} ${Date.now().toString(36)}`;
  const guestEmail = `journey-${engine}-${Date.now()}@example.com`;
  const sideErrors: string[] = [];

  await test.step('S2: the personal invite link lands on the welcome page', async () => {
    await gotoScreen(page, 's02-personal-link');
    await expect(page.getByRole('main')).toBeVisible();
  });

  await test.step('S6: tap an open time on the picker', async () => {
    await gotoScreen(page, 's06-picker-open');
    const panel = page.getByRole('tabpanel');
    const tile = panel
      .getByRole('button', { pressed: false, disabled: false })
      .nth(engine === 'webkit' ? 1 : 0);
    await clickLikeAPerson(page, tile);
    await expect(panel.getByRole('button', { pressed: true })).toHaveCount(1);
  });

  await test.step('S10: the details, then Send', async () => {
    // As tests/e2e/send does: the personal invite may prefill a field, so each one present is retyped (this run's
    // own name and email, so the admin row and the outbox mail are this run's).
    // T1.7.U2: the personal invite's details sit behind "Sending as … · Change".
    const change = page.getByRole('button', { name: 'Change', exact: true });
    if (await change.count()) await clickLikeAPerson(page, change);
    for (const [label, value] of [
      [/^Your name/, guestName],
      [/^Your email/, guestEmail],
    ] as const) {
      const field = page.getByRole('textbox', { name: label });
      if (await field.count()) await retype(page, field, value);
    }
    await clickLikeAPerson(page, page.getByRole('button', { name: /^Send$/ }));
    await page.waitForURL((next) => next.pathname === ROUTES.sent);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(AFTER_SEND.stamp);
  });

  await test.step('S11: a story and a photo, sent', async () => {
    // Photo storage stays on the box (the prototype's mock sign answer, as tests/e2e/guest-after does).
    await page.route('**/api/photos/sign*', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"mock":true}' }),
    );
    await typeLikeAPerson(page, page.getByRole('textbox', { name: AFTER_SEND.question }), 'The long lunch.');
    // The file itself goes in as tests/e2e/guest-after/s11-picker does (no OS dialog in a headless run).
    await page
      .getByLabel(AFTER_SEND.photoButton)
      .setInputFiles({ name: 'moment.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('group', { name: PHOTO_PICKER.photoName(1) })).toHaveClass(/photo--added/);
    await clickLikeAPerson(page, page.getByRole('button', { name: STORY_FORM.send }));
    await expect(page.getByText(AFTER_SEND.thanks)).toBeVisible({ timeout: 15_000 });
  });

  await test.step("A2 -> A3: the admin opens this run's request and locks it in; the undo window runs out", async () => {
    const admin = await sidePage(browser, sideErrors);
    await signInAs(admin.context(), 'admin', baseURL!);
    await admin.goto(ROUTES.admin.requests);
    // This run's row: the name typed on S10 is unique per run and engine. Other runs' rows can push it
    // below the fold (webkit-1440), so scroll it into view first; humanClick refuses off-screen controls.
    const row = admin.getByRole('link', { name: new RegExp(guestName) });
    await row.scrollIntoViewIfNeeded();
    await clickLikeAPerson(admin, row);
    await admin.waitForURL(/\/admin\/requests\/[^/]+$/);
    // Three phases, each with its own bound: the undo window (the toast's own count), the POST /lock round trip,
    // the A3 line. On a stuck POST, pg_stat_activity is attached (support/lock-landing.ts).
    await lockInAndLand(admin, test.info());
    await admin.context().close();
  });

  await test.step('E4: the invite email is in /dev/outbox, with a manage link', async () => {
    const pass = process.env.DEV_PASSPHRASE;
    expect(pass, 'DEV_PASSPHRASE (scripts/ci-placeholder-env.sh)').toBeTruthy();
    const dev = await sidePage(browser, sideErrors);
    await dev.goto('/dev/login');
    await typeLikeAPerson(dev, dev.getByLabel('Passphrase'), pass!);
    await press(dev, 'Enter');
    await dev.waitForURL(/\/dev\/outbox$/);
    const mail = dev
      .getByRole('article')
      .filter({ hasText: `to ${guestEmail}` })
      .filter({ hasText: /^E4 ·/ });
    await expect(mail).toHaveCount(1);
    await expect(mail.locator('pre')).toContainText(/\/manage\?t=\S+/);
    await dev.context().close();
  });

  expect(sideErrors, 'admin + /dev page errors').toEqual([]);
});

test('T4.3.02 journey: manage -> cancel', () => test.fixme(true, MANAGE_PAGES));
test('T4.3.02 journey: the window reopens after the cancel', () => test.fixme(true, MANAGE_PAGES));
test('T4.3.02 journey: the stand-by guest gets the offer', () => test.fixme(true, MANAGE_PAGES));
