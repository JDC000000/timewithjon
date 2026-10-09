// tests/e2e/support/server-bounds.ts — named bounds for guest steps that wait on the server, not on the page (as
// LOCK_ROUND_TRIP_MS in lock-landing.ts). The E2E server is one Next process sharing its runner with the browsers;
// on a busy WebKit run a story save answered after 2.2 s and 4.2 s and a photo sign was still unanswered at 5 s
// (main, story-page.spec.ts:97), past the generic 5 s expect budget. Each bound names the server work it waits for,
// so a slow server shows up as that step; a stuck one still fails.
import type { Page, Response } from '@playwright/test';
import { AFTER_SEND } from '../../../src/content';
import { expect } from './fixtures';

/** A story save: POST /api/stories (S11, S17) or /api/story-page (S19), its row and its email work. */
export const STORY_SAVE_MS = 15_000;
/**
 * A picked photo reaching "Added": POST /api/photos/sign (the prototype answers { mock: true }, so nothing is stored),
 * and on S19 a story save first when the photo comes before any words (uploader.ts holds the sign until it has one).
 */
export const PHOTO_ADDED_MS = 15_000;

const isStorySave = (r: Response) =>
  r.request().method() === 'POST' && /^\/api\/(stories|story-page)$/.test(new URL(r.url()).pathname);

/**
 * Send a story the caller's way (`send`: a click on Send) and see it saved: the POST answers OK within
 * STORY_SAVE_MS, then the thank-you line shows within the normal budget.
 */
export async function sendStoryAndSee(page: Page, send: () => Promise<void>): Promise<void> {
  const answered = page.waitForResponse(isStorySave, { timeout: STORY_SAVE_MS });
  answered.catch(() => undefined); // reported by the await below
  await send();
  const res = await answered;
  expect(res.ok(), `story save answered ${res.status()}`).toBe(true);
  await expect(page.getByText(AFTER_SEND.thanks)).toBeVisible();
}
