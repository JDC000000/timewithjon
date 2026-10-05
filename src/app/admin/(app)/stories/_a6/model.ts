// src/app/admin/(app)/stories/_a6/model.ts — T2.9.U1 / T3.7.U1: the A6 words for one story (wireframe 09 A6) and
// the "Add emailed story" checks. Pure: no reads, no React.
import { dishInSentence } from '@/content/menu-helpers';
import type { StoryItem } from '@/features/admin/stories';
import { ADD_STORY, STORIES } from '@/content/ui/admin-season';
import { ERRORS } from '@/content';
import { MAX_PHOTOS } from '@/features/photos/limits';

type Story = Pick<StoryItem, 'fromName' | 'source' | 'consent' | 'spamSuspect' | 'request'>;

/** The name on the row: who wrote it, else the booking's guest. */
export function storyWho(s: Story): string {
  return s.fromName?.trim() || s.request?.contactName.trim() || STORIES.noName;
}

/** "after The Long Lunch", or "sent by email" for an emailed story; null when neither applies. */
export function storyContext(s: Story): string | null {
  if (s.request?.dishName) return STORIES.after(dishInSentence(s.request.dish));
  return s.source === 'email_in' ? STORIES.byEmail : null;
}

/** "OK for the book" / "not for the book"; a spam suspect can't be either yet. */
export function storyStatus(s: Story): string {
  if (s.spamSuspect) return STORIES.spam;
  return s.consent ? STORIES.ok : STORIES.notOk;
}

/** The row's meta line pieces, shown with " · " (and read with commas). */
export function storyMeta(s: Story): string[] {
  return [storyContext(s), storyStatus(s)].filter((x): x is string => x !== null);
}

export const MAX_EMAILED_PHOTOS = MAX_PHOTOS.email_in; // T3.7.03 (pr82-review F4: one source)

export interface EmailedStoryForm {
  name: string;
  email: string;
  story: string;
  photos: number;
}

export type EmailedStoryField = 'name' | 'email' | 'story' | 'photos';

// The route's own zod check (z.email) is the authority; this only catches the obvious slips before the round trip.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The sheet's field errors, in form order ({} = ready to send). Limits match EmailedStoryBody. */
export function emailedStoryErrors(f: EmailedStoryForm): Partial<Record<EmailedStoryField, string>> {
  const out: Partial<Record<EmailedStoryField, string>> = {};
  const name = f.name.trim();
  const email = f.email.trim();
  if (!name || name.length > 80) out.name = ADD_STORY.errName;
  if (!EMAIL.test(email) || email.length > 254) out.email = ERRORS.badEmail;
  const story = f.story.trim();
  if (!story || story.length > 5000) out.story = ADD_STORY.errStory;
  if (f.photos > MAX_EMAILED_PHOTOS) out.photos = ADD_STORY.errPhotos;
  return out;
}

/** "Added to the book pile." (+ how many photos didn't upload) after the add sheet (`?added=<n>`); else null. */
export function addedLine(raw: string | string[] | undefined): string | null {
  if (typeof raw !== 'string' || !/^\d{1,2}$/.test(raw)) return null;
  const failed = Number(raw);
  return failed > 0 ? STORIES.addedNoPhotos(failed) : STORIES.added;
}

/**
 * Where a spam answer leaves the story (idempotent: another tab may have answered first). `cleared` = it's an
 * ordinary story now (200 on Not spam, or 409 not_spam_suspect either way); `gone` = deleted (200 on Delete, or 404
 * either way); `failed` = anything else (e.g. has_photos): Not spam stays there, so a false positive is never stuck.
 */
export function spamOutcome(
  action: 'not-spam' | 'delete',
  res: { status: number; code: string | null },
): 'cleared' | 'gone' | 'failed' {
  if (res.status === 404) return 'gone';
  if (res.status === 409 && res.code === 'not_spam_suspect') return 'cleared';
  if (res.status === 200) return action === 'not-spam' ? 'cleared' : 'gone';
  return 'failed';
}
