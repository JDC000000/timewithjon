// T1.7.U2 personal-link pre-fill in real browsers (T1.7 AC8): the seeded personal invite (Dave, dave@example.com)
// opens the details step on one "Sending as Dave · dave@… · Change" line with no fields; Change shows the fields
// holding those values (aria-expanded disclosure). Read-only: nothing is sent.
import { DISHES } from '../../../src/content';
import { isBookable } from '../../../src/content/menu-helpers';
import { SEND_AS } from '../../../src/app/book/[dish]/_lib/prefill';
import { expect, test } from '../support/fixtures';
import { clickLikeAPerson } from '../support/input';
import { inScope } from '../support/scope';
import { TARGET } from '../support/screens';
import { GUEST_INVITE_FOR } from '../support/sessions';

const PICKER_DISH = DISHES.find((d) => d.flow === 'picker' && isBookable(d))?.slug;

test.skip(
  ({ viewport, textMode }) => TARGET !== 'app' || !inScope(viewport, textMode, { textModes: ['t100'] }),
  'the pre-fill runs on the app, at 100 % text',
);

test('personal invite -> "Sending as Dave · dave@…" -> Change -> the filled fields', async ({ page }) => {
  expect(PICKER_DISH, 'a bookable picker dish').toBeTruthy();
  await page.goto(`/?for=${GUEST_INVITE_FOR}`);
  await page.goto(`/book/${PICKER_DISH}`);

  const line = page.locator('.sendas');
  await expect(line).toBeVisible();
  await expect(line).toContainText(`${SEND_AS.lead} Dave · dave@…`);
  await expect(line).not.toContainText('example.com');
  await expect(page.getByRole('textbox', { name: /^Your name/ })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /^Your email/ })).toHaveCount(0);

  const change = page.getByRole('button', { name: SEND_AS.change });
  await expect(change).toHaveAttribute('aria-expanded', 'false');
  await clickLikeAPerson(page, change);

  await expect(line).toHaveCount(0);
  const name = page.getByRole('textbox', { name: /^Your name/ });
  await expect(name).toHaveValue('Dave');
  await expect(name).toBeFocused();
  await expect(page.getByRole('textbox', { name: /^Your email/ })).toHaveValue('dave@example.com');
});
