// src/lib/capability.ts — C2 request capability: twj_req = HMAC(request_id, exp), 2 hours.
import 'server-only';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/config/env';
import { MANAGE_HEADER, manageGrant } from '@/features/invites/action-tokens';
import { signCookie, verifyCookie } from '@/features/invites/tokens';

export const REQ_COOKIE = 'twj_req';
export const REQ_TTL_SECONDS = 2 * 3600;
export function setRequestCapability(res: NextResponse, requestId: string) {
  res.cookies.set(
    REQ_COOKIE,
    signCookie('req', requestId, REQ_TTL_SECONDS, getEnv().SESSION_SIGNING_SECRET),
    {
      httpOnly: true,
      secure: getEnv().NEXT_PUBLIC_SITE_URL.startsWith('https'),
      sameSite: 'lax',
      path: '/',
      maxAge: REQ_TTL_SECONDS,
    },
  );
}
/** The ONLY source of request_id for After Send + photo endpoints (never the body). */
export async function readRequestCapability(): Promise<string | null> {
  return verifyCookie('req', (await cookies()).get(REQ_COOKIE)?.value, getEnv().SESSION_SIGNING_SECRET);
}

/**
 * T2.7.06 (L7): the After-Send story and photo endpoints also accept a manage token (x-twj-manage), so S17's
 * "Add a story or photo" works after the 2-hour twj_req has gone. Either way the request is the one the
 * credential names, never one from the body; the routes' limits apply the same to both.
 */
export async function readStoryCapability(req: NextRequest): Promise<string | null> {
  // A manage header wins outright: a twj_req left over from another Send must never redirect S17's story.
  const manage = req.headers.get(MANAGE_HEADER);
  return manage === null ? readRequestCapability() : manageGrant(manage);
}

// T3.12.01: the story-page capability, twj_story = HMAC(story_id, exp). Issued only after requireInvite on the
// first story-page save; later saves and the story's photo endpoints take the story id ONLY from it.
export const STORY_COOKIE = 'twj_story';
export const STORY_TTL_SECONDS = 2 * 3600;
export function setStoryCapability(res: NextResponse, storyId: string) {
  res.cookies.set(
    STORY_COOKIE,
    signCookie('story', storyId, STORY_TTL_SECONDS, getEnv().SESSION_SIGNING_SECRET),
    {
      httpOnly: true,
      secure: getEnv().NEXT_PUBLIC_SITE_URL.startsWith('https'),
      sameSite: 'lax',
      path: '/',
      maxAge: STORY_TTL_SECONDS,
    },
  );
}
export async function readStoryPageCapability(): Promise<string | null> {
  return verifyCookie('story', (await cookies()).get(STORY_COOKIE)?.value, getEnv().SESSION_SIGNING_SECRET);
}
