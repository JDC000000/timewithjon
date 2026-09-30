// src/features/photos/caller-story.ts — which story a guest's photo call is for, from capabilities ONLY (C2).
// After Send (default) → twj_req or a manage token → its After-Send story. `?for=story_page` (T3.12.01) → a valid,
// unrevoked invite (pr43 F3) AND twj_story, naming a story_page story saved through that same invite. A sign with the
// invite but no twj_story yet (a photo picked before the first Send) creates the story and issues twj_story.
// The target comes from the query string, so the capability is checked before the body is read (AD-9, pr43 F5).
import 'server-only';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { ERRORS } from '@/content';
import {
  readStoryCapability,
  readStoryPageCapability,
  setStoryCapability,
} from '@/features/invites/capability';
import { requireInvite } from '@/features/invites/require';
import { jsonError } from '@/lib/http';
import { afterSendStoryId, ensureAfterSendStory } from './story';
import { ownStoryPageStory, saveStoryPageStory } from './story-page';

export type PhotoTarget = 'after_send' | 'story_page';
/** Anything but exactly `for=story_page` means After Send. */
export const photoTarget = (req: NextRequest): PhotoTarget =>
  req.nextUrl.searchParams.get('for') === 'story_page' ? 'story_page' : 'after_send';

/** `storyId` null = the capability holds but names no story of the caller's (sign: 403, finalise: 404). */
export type CallerStory = { storyId: string | null } | { response: NextResponse };
const expired = (): CallerStory => ({ response: jsonError(403, 'capability_expired', ERRORS.stale) });

/**
 * `create` (sign only): with a valid invite and no twj_story yet, the story is created on first use, as the first
 * save would create it, and twj_story is issued through next/headers (Next applies it to the route's response), so
 * the later save and finalise name the same story. A twj_story that is present but not this invite's is never
 * replaced: it stays null (403).
 */
async function storyPageStory(create: boolean): Promise<CallerStory> {
  const gate = await requireInvite();
  if ('response' in gate) return gate;
  const storyId = await readStoryPageCapability();
  if (storyId) return { storyId: await ownStoryPageStory(storyId, gate.invite.id) };
  if (!create) return expired();
  const created = await saveStoryPageStory(null, gate.invite, { consent: false });
  // setStoryCapability only calls res.cookies.set, which the request cookie store also has.
  setStoryCapability({ cookies: await cookies() } as unknown as NextResponse, created);
  return { storyId: created };
}

/** Sign: the After-Send story (L7) and the story-page story are both created on first use. */
export async function callerStoryForSign(req: NextRequest): Promise<CallerStory> {
  if (photoTarget(req) === 'story_page') return storyPageStory(true);
  const requestId = await readStoryCapability(req);
  return requestId ? { storyId: await ensureAfterSendStory(requestId) } : expired();
}

/** Finalise never creates a story. */
export async function callerStoryForFinalise(req: NextRequest): Promise<CallerStory> {
  if (photoTarget(req) === 'story_page') return storyPageStory(false);
  const requestId = await readStoryCapability(req);
  return requestId ? { storyId: await afterSendStoryId(requestId) } : expired();
}
