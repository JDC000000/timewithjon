// T4.3.07: privacy, end to end in real browsers with real input only (technical-scope §9, §12 Privacy).
// - T1.4 AC1/AC3: a `?for=` guess (the right name, no secret or the wrong one) shows nothing personal, sets no
//   session, and the link lands on a URL with no `?for=` (src/app/api/invite/resolve/route.ts).
// - T0.1 AC2: every response carries `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: same-origin`
//   (next.config.ts SECURITY_HEADERS): a page, the `?for=` redirect itself, an API route.
// - T2.6 AC3: the general link rotated while a guest is mid-form: their Send is refused with the S16 stale line and
//   nothing is booked; the old link shows S16, the new one (read from the rotate response) books.
// Scope: 1440 at 100 % once per engine, first repeat only (the invite lookup is rate-limited, and the rotation
// writes to the DB). Serial. The rotation shares state with other specs, so it is isolated two ways:
// - it holds early-rollout's Postgres session lock (and so do both engines' rotations): early-rollout moves the
//   general release to March 1 mid-run, which refused this case's "new link books" Send; and one engine's
//   rotation must not revoke the other's "new" link before it books;
// - `finally` puts the seeded general link (supabase/seed.sql, `friends-g3hx8q2v`) back as the active one: other
//   specs open it by its literal ?for= value.
import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { Client } from 'pg';
import { DISHES, ERRORS } from '../../../src/content';
import { AFTER_SEND, OPEN_LINE } from '../../../src/content/site';
import { isBookable } from '../../../src/content/menu-helpers';
import { ROUTES } from '../../../src/ui/routes';
import { expect, test, WEBKIT_RSC_ABORT } from '../support/fixtures';
import { clickLikeAPerson, typeLikeAPerson } from '../support/input';
import { inScope } from '../support/scope';
import { TARGET } from '../support/screens';
import { adminSessionCookie, signInAs } from '../support/sessions';

const SCOPE = { viewports: ['w1440'], textModes: ['t100'] } as const;
const PICKER_DISH = DISHES.find((d) => d.flow === 'picker' && isBookable(d))?.slug;
/** The seeded personal invite (supabase/seed.sql): what a guess must never show. */
const DAVE = { name: /Dave/, ourThings: ['the Seymour lap', 'Tofino again'] as const };
/** The seeded general invite (supabase/seed.sql): other specs use its literal link. */
const SEEDED_GENERAL = { secret: 'g3hx8q2v', slug: 'friends' } as const;

test.skip(
  ({ viewport, textMode }) => TARGET !== 'app' || !inScope(viewport, textMode, SCOPE),
  'T4.3.07 privacy: app target, 1440 at 100 % (once per engine)',
);
test.describe.configure({ mode: 'serial' });
test.beforeEach(() => {
  test.skip(test.info().repeatEachIndex > 0, 'rate-limited lookups + a DB write: first repeat only');
});

/** A side browser context (a second guest, or a fresh visitor) with its own page-error watch. */
async function sidePage(browser: Browser, errors: string[], expected?: RegExp): Promise<Page> {
  const side = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  // WebKit reports a Next.js RSC prefetch aborted by a navigation as an error (same noise as support/fixtures).
  const noise = (msg: string) => browser.browserType().name() === 'webkit' && WEBKIT_RSC_ABORT.test(msg);
  side.on('pageerror', (e) => {
    if (!noise(e.message)) errors.push(e.message);
  });
  side.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !noise(m.text()) &&
      !(expected && expected.test(`${m.text()} ${m.location().url}`))
    )
      errors.push(m.text());
  });
  return side;
}

/** The admin's own API (AD-7: signed in, same origin). */
function adminHeaders(baseURL: string): Record<string, string> {
  const c = adminSessionCookie();
  return { origin: new URL(baseURL).origin, cookie: `${c.name}=${c.value}` };
}

/** An invite link as a path on the server under test (the API answers with NEXT_PUBLIC_SITE_URL's origin). */
const local = (link: string) => {
  const u = new URL(link);
  return `${u.pathname}${u.search}`;
};

async function currentGeneralLink(request: APIRequestContext, baseURL: string): Promise<string> {
  const res = await request.get('/api/admin/invites', { headers: adminHeaders(baseURL) });
  expect(res.status()).toBe(200);
  const { invites } = (await res.json()) as { invites: { kind: string; revoked: boolean; link: string }[] };
  const general = invites.find((i) => i.kind === 'general' && !i.revoked);
  expect(general, 'an active general link').toBeTruthy();
  return local(general!.link);
}

/**
 * Runs `fn` under early-rollout's Postgres session lock (released with the connection, so a crashed run leaves no
 * stale lock), then restores the seeded general link as the only active one, in one transaction under the
 * rotation's own lock (the partial unique index allows one active general row: revoke first, then un-revoke).
 */
async function withRotationLock<T>(fn: () => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(`select pg_advisory_lock(hashtext('twj_e2e_early_rollout'))`);
    try {
      return await fn();
    } finally {
      await db.query('begin');
      await db.query(`select pg_advisory_xact_lock(hashtext('twj_general_invite'))`);
      await db.query(
        `update invite set revoked_at = now()
          where kind = 'general' and revoked_at is null and not (token_secret = $1 and name_slug = $2)`,
        [SEEDED_GENERAL.secret, SEEDED_GENERAL.slug],
      );
      const { rowCount } = await db.query(
        `update invite set revoked_at = null where kind = 'general' and token_secret = $1 and name_slug = $2`,
        [SEEDED_GENERAL.secret, SEEDED_GENERAL.slug],
      );
      await db.query('commit');
      expect(rowCount, 'the seeded general link is restored').toBe(1);
    }
  } finally {
    await db.end(); // ends the session: the advisory lock goes with it
  }
}

/** Pick an open time on the picker (its own tile per engine, so the two engines never ask for the same time). */
async function pickATime(page: Page, engine: string): Promise<void> {
  await page.goto(`/book/${PICKER_DISH}`);
  const panel = page.getByRole('tabpanel');
  await clickLikeAPerson(
    page,
    panel.getByRole('button', { pressed: false, disabled: false }).nth(engine === 'webkit' ? 3 : 2),
  );
  await expect(panel.getByRole('button', { pressed: true })).toHaveCount(1);
}

test('T0.1 AC2: noindex + same-origin referrer on a page, the ?for= redirect and an API route', async ({
  request,
}) => {
  const answers = [
    ['/', await request.get('/', { maxRedirects: 0 })],
    ['/?for=dave', await request.get('/?for=dave', { maxRedirects: 0 })],
    ['/api/health', await request.get('/api/health', { maxRedirects: 0 })],
  ] as const;
  expect(answers[1][1].status(), 'the ?for= link is a redirect').toBe(303);
  for (const [url, res] of answers) {
    expect(res.headers()['x-robots-tag'], url).toBe('noindex, nofollow');
    expect(res.headers()['referrer-policy'], url).toBe('same-origin');
  }
});

for (const guess of ['dave', 'dave-wrong123']) {
  test(`T1.4 AC3: ?for=${guess} shows nothing personal and drops ?for=`, async ({ page, context }) => {
    await page.goto(`/?for=${guess}`);
    expect(new URL(page.url()).search, 'the URL keeps no ?for=').not.toContain('for=');
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByText(DAVE.name)).toHaveCount(0);
    for (const thing of DAVE.ourThings) await expect(page.getByText(thing)).toHaveCount(0);
    expect((await context.cookies()).map((c) => c.name)).not.toContain('twj_invite');

    // No session: the picker is the S16 stale line, not the times.
    await page.goto(`/book/${PICKER_DISH}`);
    await expect(page.getByText(ERRORS.stale).first()).toBeVisible();
    await expect(page.getByRole('tabpanel')).toHaveCount(0);
    await expect(page.getByText(DAVE.name)).toHaveCount(0);
  });
}

test('control: the real personal session does show Dave (so the guesses above can fail)', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, 'guest', baseURL!);
  await page.goto('/');
  await expect(page.getByText(DAVE.name).first()).toBeVisible();
  // Jon (2026-10-05): an invite's things are never shown; the hero line is the one everyone sees.
  await expect(page.getByText(OPEN_LINE)).toBeVisible();
  await expect(page.getByText(DAVE.ourThings[0], { exact: false })).toHaveCount(0);
});

test('T2.6 AC3: the general link rotated mid-form -> Send refused (S16), old link S16, new link books', async ({
  browser,
  request,
  baseURL,
}) => {
  test.setTimeout(240_000);
  expect(PICKER_DISH, 'a bookable picker dish').toBeTruthy();
  const engine = test.info().project.name.startsWith('webkit') ? 'webkit' : 'chromium';
  const stamp = Date.now().toString(36);
  const errors: string[] = [];

  await withRotationLock(async () => {
    const oldLink = await currentGeneralLink(request, baseURL!);
    const guestName = `Rotated ${engine} ${stamp}`;
    // The refused Send is a 403 from POST /api/requests: the browser logs that one failed load, nothing else.
    const guest = await sidePage(browser, errors, /status of 403.*\/api\/requests/);

    await test.step('the guest opens the general link and fills S10 part-way', async () => {
      await guest.goto(oldLink);
      expect(new URL(guest.url()).search).not.toContain('for=');
      await pickATime(guest, engine);
      await typeLikeAPerson(guest, guest.getByRole('textbox', { name: /^Your name/ }), guestName);
    });

    let newLink = '';
    await test.step('the admin rotates the general link', async () => {
      const res = await request.post('/api/admin/invites/rotate-general', {
        headers: adminHeaders(baseURL!),
      });
      expect(res.status()).toBe(200);
      const { invite } = (await res.json()) as { invite: { kind: string; revoked: boolean; link: string } };
      expect(invite).toMatchObject({ kind: 'general', revoked: false });
      newLink = local(invite.link);
      expect(newLink).not.toBe(oldLink);
    });

    await test.step('the guest sends: refused with the S16 stale line, still on S10', async () => {
      await typeLikeAPerson(
        guest,
        guest.getByRole('textbox', { name: /^Your email/ }),
        `rot-${stamp}@example.com`,
      );
      await clickLikeAPerson(guest, guest.getByRole('button', { name: /^Send$/ }));
      await expect(guest.getByText(ERRORS.stale).first()).toBeVisible();
      expect(new URL(guest.url()).pathname).toBe(`/book/${PICKER_DISH}`);
      await guest.context().close();
    });

    await test.step('nothing was booked: no row for this guest in A2', async () => {
      const admin = await sidePage(browser, errors, /\/admin\/invites\?_rsc=/);
      await signInAs(admin.context(), 'admin', baseURL!);
      await admin.goto(ROUTES.admin.requests);
      await expect(admin.getByRole('main')).toBeVisible();
      await expect(admin.getByText(guestName)).toHaveCount(0);
      await admin.context().close();
    });

    await test.step('the old general link shows S16', async () => {
      const fresh = await sidePage(browser, errors);
      await fresh.goto(oldLink);
      expect(new URL(fresh.url()).search).not.toContain('for=');
      await fresh.goto(`/book/${PICKER_DISH}`);
      await expect(fresh.getByText(ERRORS.stale).first()).toBeVisible();
      await expect(fresh.getByRole('tabpanel')).toHaveCount(0);
      await fresh.context().close();
    });

    await test.step('the new general link books', async () => {
      const fresh = await sidePage(browser, errors);
      await fresh.goto(newLink);
      await pickATime(fresh, engine);
      await typeLikeAPerson(
        fresh,
        fresh.getByRole('textbox', { name: /^Your name/ }),
        `New link ${engine} ${stamp}`,
      );
      await typeLikeAPerson(
        fresh,
        fresh.getByRole('textbox', { name: /^Your email/ }),
        `new-${stamp}@example.com`,
      );
      await clickLikeAPerson(fresh, fresh.getByRole('button', { name: /^Send$/ }));
      await fresh.waitForURL((u) => u.pathname === ROUTES.sent);
      await expect(fresh.getByText(AFTER_SEND.stamp, { exact: true }).first()).toBeVisible();
      await fresh.context().close();
    });
  });

  expect(errors, 'side-page console errors / uncaught page errors').toEqual([]);
});
