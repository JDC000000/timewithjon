// T2.6.U1: A5 Links (TSD T2.6 AC1-AC3) end to end. AC1: the New link sheet refuses a 5-word phrase, a 41-character
// phrase and a comma on its box, counts "n/4 words" live, and its preview IS the S2 hero line (blank = the open
// line); the API refuses a 4th phrase. AC2: a revoked link shows the S16 stale line on its next request. AC3: after
// Rotate the old general link shows S16 and the new one works.
import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { A5 } from '../../../src/app/admin/(app)/invites/_a5/copy';
import { ERRORS } from '../../../src/content/microcopy';
import { OPEN_LINE, PERSONAL } from '../../../src/content/site';
import { ROUTES } from '../../../src/ui/routes';
import { signInAs } from '../support/sessions';
import { expect, test } from '../support/fixtures';
import { withRotationLock } from '../support/general-link';

/** A fresh name per run (letters only: the name rule), so its row and slug are this test's own. */
const freshName = () => 'E' + [...randomBytes(6)].map((b) => String.fromCharCode(97 + (b % 26))).join('');

async function openLinks(page: Page, baseURL: string) {
  await signInAs(page.context(), 'admin', baseURL);
  expect((await page.goto(ROUTES.admin.links))?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: A5.title })).toBeVisible();
}

const sheet = (page: Page) => page.getByRole('dialog', { name: A5.sheetTitle });
// The box's accessible name is "<label> <n/4 words>" (e.g. "1, our thing 0/4 words"): match the label prefix only.
const thing = (page: Page, n: number) =>
  sheet(page).getByRole('textbox', { name: new RegExp(`^${A5.thing(n)}(\\s|$)`) });

/** The `?for=` path of the link shown in a region (the list prints it without the scheme). Read the link's own
 * <p class="a5-link">: the region's textContent runs the link into the next text ("...?for=friends-abcnot opened"). */
async function forPath(region: ReturnType<Page['getByRole']>): Promise<string> {
  const text = (await region.locator('.a5-link').textContent()) ?? '';
  const m = /\?for=[a-z0-9-]+/.exec(text);
  expect(m, `no ?for= link in: ${text}`).not.toBeNull();
  return `/${m![0]}`;
}

/** Opens a link as a new guest (fresh context, no cookie) and returns whether the S16 stale line shows. */
async function opensStale(page: Page, baseURL: string, path: string): Promise<boolean> {
  const ctx = await page.context().browser()!.newContext({ baseURL });
  try {
    const guest = await ctx.newPage();
    // Following the link sets (or not) the twj_stale cookie; the landing Hero never renders S16.
    await guest.goto(path);
    await expect(guest.getByRole('heading', { level: 1 })).toBeVisible();
    // S16 renders where Book would be: the /menu dish sheets (in the DOM while closed, so count includes hidden).
    await guest.goto(ROUTES.menu);
    await expect(guest.getByRole('heading', { level: 1 })).toBeVisible();
    return (await guest.getByText(ERRORS.stale).count()) > 0;
  } finally {
    await ctx.close();
  }
}

async function makeLink(page: Page, name: string, things: string[]) {
  await page.getByRole('button', { name: A5.newLink }).click();
  await sheet(page).getByRole('textbox', { name: A5.name, exact: true }).fill(name);
  for (const [i, t] of things.entries()) await thing(page, i + 1).fill(t);
  await sheet(page).getByRole('button', { name: A5.save }).click();
  await expect(page.getByRole('status')).toHaveText(A5.made(name));
  return page.getByRole('listitem').filter({ hasText: name });
}

test('AC1: each box refuses 5 words, 41 characters and a comma; n/4 counts live; the preview is the S2 hero line', async ({
  page,
  baseURL,
}) => {
  await openLinks(page, baseURL!);
  await page.getByRole('button', { name: A5.newLink }).click();
  await expect(sheet(page)).toBeVisible();
  const preview = sheet(page).getByTestId('a5-preview');
  // Blank things: the open-link line.
  await expect(preview).toContainText(OPEN_LINE);

  await thing(page, 1).fill('one two three four five');
  await expect(sheet(page).getByText(A5.words(5))).toBeVisible();
  await expect(sheet(page).getByText(A5.err.four_words_max)).toBeVisible();
  await thing(page, 2).fill('x'.repeat(41));
  await expect(sheet(page).getByText(A5.err.thing_too_long)).toBeVisible();
  await thing(page, 3).fill('x, y');
  await expect(sheet(page).getByText(A5.err.no_commas)).toBeVisible();
  // Save is refused on the boxes: nothing is made.
  await sheet(page).getByRole('button', { name: A5.save }).click();
  await expect(sheet(page)).toBeVisible();
  // The page's status line sits behind the modal sheet (out of the a11y tree while it is open): include hidden.
  await expect(page.getByRole('status', { includeHidden: true }).filter({ hasText: /\S/ })).toHaveCount(0);

  // Fixed: the counts follow, the errors go, and the preview reads exactly the S2 hero line (blank box dropped).
  await thing(page, 1).fill('a long lunch');
  await thing(page, 2).fill('that bike lap');
  await thing(page, 3).fill('');
  // Per box: both phrases are 3 words, so a bare getByText('3/4 words') matches two counts.
  await expect(sheet(page).getByTestId('count-0')).toHaveText(A5.words(3));
  await expect(sheet(page).getByTestId('count-1')).toHaveText(A5.words(3));
  await expect(sheet(page).getByTestId('count-2')).toHaveText(A5.words(0));
  for (const e of [A5.err.four_words_max, A5.err.thing_too_long, A5.err.no_commas])
    await expect(sheet(page).getByText(e)).toHaveCount(0);
  await sheet(page).getByRole('textbox', { name: A5.name, exact: true }).fill('Dana');
  await expect(preview).toContainText('Dana');
  await expect(preview).toContainText(PERSONAL.ourThingsLine(['a long lunch', 'that bike lap']));

  // A 4th phrase never gets past the API.
  const res = await page.request.post('/api/admin/invites', {
    headers: { origin: new URL(baseURL!).origin },
    data: {
      name: freshName(),
      ourThings: ['a', 'b', 'c', 'd'],
      pickedDish: null,
      prefillEmail: null,
      hopedFor: true,
    },
  });
  expect(res.status()).toBe(400);
  expect(((await res.json()) as { issues: { code: string }[] }).issues).toEqual([
    expect.objectContaining({ code: 'three_max' }),
  ]);
});

test('AC2: a revoked link shows the S16 stale line on its next request', async ({ page, baseURL }) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 600,
    'desktop list pane; the create/revoke logic is one component',
  );
  await openLinks(page, baseURL!);
  const name = freshName();
  const row = await makeLink(page, name, ['a long lunch']);
  const path = await forPath(row);
  expect(await opensStale(page, baseURL!, path)).toBe(false);
  await row.getByRole('button', { name: A5.revoke }).click();
  await row.getByRole('button', { name: A5.revokeYes }).click();
  await expect(page.getByRole('status')).toHaveText(A5.revoked);
  await expect(row.getByRole('button', { name: A5.revoke })).toHaveCount(0);
  expect(await opensStale(page, baseURL!, path)).toBe(true);
});

test('AC3: after Rotate the old general link shows S16 and the new one works', async ({
  page,
  baseURL,
  browserName,
}) => {
  // One project only: two workers rotating the one general link at once would kill each other's "new" link.
  test.skip(
    browserName !== 'chromium' || (page.viewportSize()?.width ?? 0) < 600,
    'the general link is shared state: rotate it from one project',
  );
  // The general link is also shared with other specs (early-rollout opens the seeded ?for= link by its literal
  // value; privacy.spec rotates it): rotate under early-rollout's lock, and put the seeded link back after. The
  // lock wait counts against this test, so allow for early-rollout's (120 s) and privacy's (240 s) holds.
  test.setTimeout(420_000);
  await withRotationLock(async () => {
    await openLinks(page, baseURL!);
    const general = page.getByRole('region', { name: A5.general });
    const oldPath = await forPath(general);
    await general.getByRole('button', { name: A5.rotate }).click();
    await general.getByRole('button', { name: A5.rotateYes }).click();
    await expect(page.getByRole('status')).toHaveText(A5.rotated);
    await expect(general).not.toContainText(oldPath.slice(1));
    const newPath = await forPath(general);
    expect(await opensStale(page, baseURL!, oldPath)).toBe(true);
    expect(await opensStale(page, baseURL!, newPath)).toBe(false);
  });
});
