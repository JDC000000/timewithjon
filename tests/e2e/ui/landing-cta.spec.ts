// R6-M1 (Jon's H2, 2026-10-09): the landing's menu call to action is the gold "Book a Time with Jon" for everyone:
// no link, the general link, and a personal link with no picked dish (most guests). Same target, /menu.
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { BOOK_A_TIME } from '../../../src/content/site';
import { ROUTES } from '../../../src/ui/routes';

const token = () => Array.from(randomBytes(8), (b) => 'abcdefghjkmnpqrstvwxyz23456789'[b % 30]).join('');

async function goldCta(page: Page) {
  const cta = page.locator('p.cta a.btn--gold');
  await expect(cta).toHaveCount(1);
  await expect(cta).toContainText(BOOK_A_TIME);
  await expect(cta).toHaveAttribute('href', ROUTES.menu);
}

test('no link, the general link and a personal link with no picked dish: the gold "Book a Time with Jon"', async ({
  page,
  context,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) > 500, 'one run per engine (the phone project)');
  await context.clearCookies();
  await page.goto('/');
  await goldCta(page);

  await page.goto('/?for=friends-g3hx8q2v'); // the seeded general link
  await goldCta(page);

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const secret = token();
  const {
    rows: [inv],
  } = await db.query<{ id: string }>(
    `insert into invite (kind, token_secret, name_slug, display_name, is_test) values ('personal', $1, 'r6-cta', 'Robin', true)
     returning id`,
    [secret],
  );
  try {
    await page.goto(`/?for=r6-cta-${secret}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Robin');
    await goldCta(page);
  } finally {
    await db.query(`update invite set revoked_at = now() where id = $1`, [inv!.id]);
    await db.end();
  }
});
