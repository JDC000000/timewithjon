// src/features/photos/story-page.ts — T3.12.01 (F27, S19): a story without a booking, reached from a valid invite.
// The first save creates it, linked to the invite (pr43 F1: an is_test invite's stories can be purged and kept out
// of the export). A later save with twj_story through the SAME invite updates that story (never another).
import 'server-only';
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

/** Returns the story id; `existingId` (from twj_story) is honoured only for this invite's story_page story. */
export async function saveStoryPageStory(
  existingId: string | null,
  invite: StoryInvite,
  s: StoryPageInput,
): Promise<string> {
  const vals = [s.body ?? null, s.consent, s.before60Answer ?? null, s.spam ?? false];
  if (existingId) {
    const updated = await q<{ id: string }>(
      `update story set body = coalesce($2, body), consent = $3,
              consent_source = case when $3 then 'tickbox'::consent_source end,
              before60_answer = coalesce($4, before60_answer), spam_suspect = spam_suspect or $5,
              from_name = coalesce($6, from_name)
        where id = $1 and source = 'story_page' and invite_id = $7
        returning id`,
      [existingId, ...vals, s.name ?? null, invite.id],
    );
    if (updated[0]) return updated[0].id;
  }
  const rows = await q<{ id: string }>(
    `insert into story (source, invite_id, from_name, from_email, body, consent, consent_source, before60_answer,
                        spam_suspect)
     values ('story_page', $7, $5, $6, $1, $2, case when $2 then 'tickbox'::consent_source end, $3, $4)
     returning id`,
    [...vals, s.name ?? defaultFromName(invite), invite.prefill_email, invite.id],
  );
  return rows[0]!.id;
}
