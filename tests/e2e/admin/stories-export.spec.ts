// T3.10.U1: A6 "Export" in the real prototype. Reached by keyboard next to "Add emailed story", a 44 px target
// inside the viewport, and Enter starts a download of the stories zip (the prototype answers the zip itself:
// its exports bucket is in memory). One export runs at a time on the server, so the projects take turns under a
// Postgres session lock (released with the connection).
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { ERRORS } from '../../../src/content/microcopy';
import { STORIES } from '../../../src/content/ui/admin-season';
import { ROUTES } from '../../../src/ui/routes';
import { signInAs } from '../support/sessions';
import { expect, test } from '../support/fixtures';

async function oneExportAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(`select pg_advisory_lock(hashtext('twj_e2e_export'))`);
    return await fn();
  } finally {
    await db.end();
  }
}

test('A6 Export: by keyboard, Enter downloads the stories zip', async ({ page, baseURL }) => {
  await signInAs(page.context(), 'admin', baseURL!);
  expect((await page.goto(ROUTES.admin.stories))?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: STORIES.title })).toBeVisible();

  const add = page.getByRole('button', { name: STORIES.add });
  const exportButton = page.getByRole('button', { name: STORIES.export, exact: true });
  await expect(add).toBeVisible();
  await expect(exportButton).toBeVisible();
  const box = (await exportButton.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  for (let i = 0; i < 40 && !(await exportButton.evaluate((n) => n === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(exportButton).toBeFocused();

  const download = await oneExportAtATime(async () => {
    const started = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    return started;
  });
  expect(download.suggestedFilename()).toMatch(/^time-with-jon-stories-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = await readFile((await download.path())!);
  expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');
  await expect(exportButton).toHaveText(STORIES.export);
  await expect(page.getByText(ERRORS.generic)).toHaveCount(0);
});
