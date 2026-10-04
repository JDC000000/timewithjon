// src/features/photos/story-page.ts — T3.12.01 (F27, S19): a story without a booking, reached from a valid invite.
// The first save of a page view creates it, linked to the invite (pr43 F1: an is_test invite's stories can be purged
// and kept out of the export), idempotently on the page view's key. A later save in that page view, with twj_story
// through the SAME invite, updates that story (never another, and never a new one). A photo sign never creates one:
// the page's first save does (createStoryPageStory, the only insert).
import 'server-only';
import { createHash } from 'node:crypto';
import { q } from '@/lib/db';
import type { Invite } from '@/features/invites/repo';

export interface StoryPageInput {
  name?: string;
  body?: string;
  consent: boolean;
  before60Answer?: string;
  spam?: boolean;
}

type StoryInvite = Pick<Invite, 'id' | 'kind' | 'display_name' | 'prefill_name' | 'prefill_email'>;

/**
 * pr43 F4: with no typed name, only a name that is this guest's: a personal invite's label or the prefill. A
 * general invite's label names a group, not the author, so the story stays unnamed (A6 "needs Jon").
 */
export const defaultFromName = (invite: StoryInvite): string | null =>
  (invite.kind === 'personal' ? invite.display_name : null) ?? invite.prefill_name;

/** The story twj_story names, only if it's a story_page story saved through this invite (pr43 F3). */
export async function ownStoryPageStory(storyId: string, inviteId: string): Promise<string | null> {
  const rows = await q<{ id: string }>(
    `select id from story where id = $1 and source = 'story_page' and invite_id = $2`,
    [storyId, inviteId],
  );
  return rows[0]?.id ?? null;
}

/**
 * Updates this invite's story_page story `storyId` (from twj_story). Null when no such story is left (Jon deleted
 * it after the capability was read): nothing is written, the route answers the stale line. A story is only ever
 * created by createStoryPageStory, behind the Turnstile check and the daily limit.
 */
export async function saveStoryPageStory(
  storyId: string,
  invite: StoryInvite,
  s: StoryPageInput,
): Promise<string | null> {
  const updated = await q<{ id: string }>(
    `update story set body = coalesce($2, body), consent = $3,
            consent_source = case when $3 then 'tickbox'::consent_source end,
            before60_answer = coalesce($4, before60_answer), spam_suspect = spam_suspect or $5,
            from_name = coalesce($6, from_name)
      where id = $1 and source = 'story_page' and invite_id = $7
      returning id`,
    [
      storyId,
      s.body ?? null,
      s.consent,
      s.before60Answer ?? null,
      s.spam ?? false,
      s.name ?? null,
      invite.id,
    ],
  );
  return updated[0]?.id ?? null;
}

/** The story a page view's first save made with `clientKey` through this invite (a retried first save). */
export async function storyPageStoryByKey(clientKey: string, inviteId: string): Promise<string | null> {
  const rows = await q<{ id: string }>(
    `select id from story where source = 'story_page' and idempotency_key = $1 and invite_id = $2`,
    [clientKey, inviteId],
  );
  return rows[0]?.id ?? null;
}

/**
 * A new story_page story for this invite (the route has already applied the Turnstile check and the daily limit).
 * `clientKey` (the page view's key) makes the first save idempotent on story(source, idempotency_key): a retry
 * whose answer was lost gets the same story, never a second one. Null when the key is already another invite's.
 */
export async function createStoryPageStory(
  invite: StoryInvite,
  s: StoryPageInput,
  clientKey: string | null = null,
): Promise<string | null> {
  const hash = clientKey
    ? createHash('sha256')
        .update(JSON.stringify([s.name, s.body, s.consent, s.before60Answer]))
        .digest('hex')
    : null;
  const rows = await q<{ id: string }>(
    `insert into story (source, invite_id, from_name, from_email, body, consent, consent_source, before60_answer,
                        spam_suspect, idempotency_key, idempotency_payload_hash)
     values ('story_page', $7, $5, $6, $1, $2, case when $2 then 'tickbox'::consent_source end, $3, $4, $8, $9)
     on conflict (source, idempotency_key) where idempotency_key is not null do nothing
     returning id`,
    [
      s.body ?? null,
      s.consent,
      s.before60Answer ?? null,
      s.spam ?? false,
      s.name ?? defaultFromName(invite),
      invite.prefill_email,
      invite.id,
      clientKey,
      hash,
    ],
  );
  if (rows[0]) return rows[0].id;
  return clientKey ? storyPageStoryByKey(clientKey, invite.id) : null; // a concurrent twin of this first save
}
