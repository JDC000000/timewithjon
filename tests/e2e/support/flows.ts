// Journey steps shared by the T4.3.09 cases, done with real input only (click, type), selected by role / name.
import { expect, type Page } from '@playwright/test';
import { clickLikeAPerson, typeLikeAPerson } from './input';

/** The toast's Undo on A3b (the contract's undoVh: 'Undo' + ' lock-in for <guest>'). */
export const TOAST_UNDO = { name: /^Undo lock-in for / };

/** S6 / S10: fill the guest's details (only the empty ones) and press Send. */
export async function sendRequest(page: Page): Promise<void> {
  const fields: [RegExp, string][] = [
    [/^Your name/, 'Sam Rivera'],
    [/^Your email/, 'sam@example.com'],
  ];
  for (const [name, value] of fields) {
    const field = page.getByRole('textbox', { name });
    if ((await field.count()) && !(await field.inputValue())) await typeLikeAPerson(page, field, value);
  }
  const url = page.url();
  await clickLikeAPerson(page, page.getByRole('button', { name: /^Send$/ }));
  await page.waitForURL((next) => next.toString() !== url);
}

/** A3: press "Lock in …" and wait for the undo toast. */
export async function lockIn(page: Page): Promise<void> {
  await clickLikeAPerson(page, page.getByRole('button', { name: /^Lock in/ }));
  await expect(page.getByRole('button', TOAST_UNDO)).toBeVisible();
}

/** The browser's Back. A back/forward-cache restore fires no new load event, so wait for the commit only. */
export async function goBack(page: Page): Promise<void> {
  await page.goBack({ waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded');
}
