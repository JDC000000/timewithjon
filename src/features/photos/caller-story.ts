// src/features/photos/caller-story.ts — which story a guest's photo call is for, from capabilities ONLY (C2).
// After Send (default) → twj_req or a manage token → its After-Send story. `?for=story_page` (T3.12.01) → a valid,
// unrevoked invite (pr43 F3) AND twj_story, naming a story_page story saved through that same invite. Neither sign
// nor finalise creates a story_page story: the page's first save does (/api/story-page), so a photo picked before
// the first Send waits for that save (the story form opens the story first).
// The target comes from the query string, so the capability is checked before the body is read (AD-9, pr43 F5).
import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { ERRORS } from '@/content';
import { readStoryCapability, readStoryPageCapability } from '@/features/invites/capability';
import { requireInvite } from '@/features/invites/require';
import { jsonError } from '@/lib/http';
import { afterSendStoryId, ensureAfterSendStory } from './story';
import { pageStory } from './story-page';

export type PhotoTarget = 'after_send' | 'story_page';
/** Anything but exactly `for=story_page` means After Send. */
export const photoTarget = (req: NextRequest): PhotoTarget =>
  req.nextUrl.searchParams.get('for') === 'story_page' ? 'story_page' : 'after_send';

/** `storyId` null = the capability holds but names no story of the caller's (sign: 403, finalise: 404). */
export type CallerStory = { storyId: string | null } | { response: NextResponse };
const expired = (): CallerStory => ({ response: jsonError(403, 'capability_expired', ERRORS.stale) });

/**
 * The caller's story_page story: the one this page view's key (`?key=`) made through this invite, while twj_story
 * holds. No twj_story yet means no story yet (capability_expired); no key or another tab's story means none of
 * the caller's (sign 403, finalise 404), so a photo never lands in another tab's story.
 */
async function storyPageStory(req: NextRequest): Promise<CallerStory> {
  const gate = await requireInvite();
  if ('response' in gate) return gate;
  const capability = await readStoryPageCapability();
  if (!capability) return expired();
  const key = req.nextUrl.searchParams.get('key');
  const clientKey = key && UUID.test(key) ? key : null;
  return { storyId: await pageStory(capability, clientKey, gate.invite.id) };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sign: the After-Send story (L7) is created on first use; the story-page story only by its first save. */
export async function callerStoryForSign(req: NextRequest): Promise<CallerStory> {
  if (photoTarget(req) === 'story_page') return storyPageStory(req);
  const requestId = await readStoryCapability(req);
  return requestId ? { storyId: await ensureAfterSendStory(requestId) } : expired();
}

/** Finalise never creates a story. */
export async function callerStoryForFinalise(req: NextRequest): Promise<CallerStory> {
  if (photoTarget(req) === 'story_page') return storyPageStory(req);
  const requestId = await readStoryCapability(req);
  return requestId ? { storyId: await afterSendStoryId(requestId) } : expired();
}
