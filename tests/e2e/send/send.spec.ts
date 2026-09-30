// T1.7.U4 guest Send, end to end in real browsers with real input only: the personal invite link -> a time on the
// picker -> Send (a blank name first shows the one new line, DETAILS.nameError) -> the Sent page -> the request is a
// row in the admin's A2 list. Writes to the loopback test DB only (global-setup refuses any other server).
import { randomUUID } from 'node:crypto';
import { DISHES } from '../../../src/content';
import { AFTER_SEND } from '../../../src/content/site';
import { DETAILS } from '../../../src/content/ui/booking';
import { isBookable } from '../../../src/content/menu-helpers';
import { ROUTES } from '../../../src/ui/routes';
import { expect, test } from '../support/fixtures';
import { clickLikeAPerson, typeLikeAPerson } from '../support/input';
import { inScope } from '../support/scope';
import { TARGET } from '../support/screens';
import { GUEST_INVITE_FOR, signInAs } from '../support/sessions';

const PICKER_DISH = DISHES.find((d) => d.flow === 'picker' && isBookable(d))?.slug;

test.skip(
  ({ viewport, textMode }) => TARGET !== 'app' || !inScope(viewport, textMode, { textModes: ['t100'] }),
  'the Send round trip runs on the app, at 100 % text',
);

test('personal invite -> pick a time -> Send -> Sent. -> a row in A2', async ({ page, context, baseURL }) => {
  expect(PICKER_DISH, 'a bookable picker dish').toBeTruthy();
  const who = `Dave ${randomUUID().slice(0, 8)}`; // this run's row, whatever else the list holds

  // The link Jon sends: it sets the invite cookie and lands on the menu.
  await page.goto(`/?for=${GUEST_INVITE_FOR}`);
  await page.goto(`/book/${PICKER_DISH}`);
  await clickLikeAPerson(
    page,
    page.getByRole('tabpanel').getByRole('button', { pressed: false, disabled: false }).last(),
  );

  // The personal invite prefills the name: clear it by keyboard, Send, and the new line shows.
  // T1.7.U2: the personal invite's details sit behind "Sending as … · Change".
  await clickLikeAPerson(page, page.getByRole('button', { name: 'Change', exact: true }));
  const name = page.getByRole('textbox', { name: /^Your name/ });
  await clickLikeAPerson(page, name);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect(name).toHaveValue('');
  const send = page.getByRole('button', { name: /^Send$/ });
  await clickLikeAPerson(page, send);
  await expect(page.getByText(DETAILS.nameError).first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/book/${PICKER_DISH}`);

  await typeLikeAPerson(page, name, who);
  await clickLikeAPerson(page, send);
  await page.waitForURL((u) => u.pathname === ROUTES.sent);
  await expect(page.getByText(AFTER_SEND.stamp, { exact: true }).first()).toBeVisible();

  await signInAs(context, 'admin', baseURL!);
  await page.goto(ROUTES.admin.requests);
  await expect(page.getByText(who).first()).toBeVisible();
});
