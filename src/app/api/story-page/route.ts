// src/app/api/story-page/route.ts — T3.12.01 (F27, S19): save a story without a booking. A valid invite is
// required (AC2); the story id comes ONLY from the twj_story capability, never the body. AD-9 order:
// Origin → per-IP limit → invite → body; a filled honeypot is stored as spam_suspect with the same answer.
// The FIRST save (no twj_story of this invite's) creates the story, so it carries the general invite's Turnstile
// token (as /api/requests does), counts toward the invite's daily limit and, for a personal invite, its total.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { readStoryPageCapability, setStoryCapability } from '@/features/invites/capability';
import { requireInvite } from '@/features/invites/require';
import { STORY_PAGE_MAX_PER_INVITE } from '@/features/photos/limits';
import { createStoryPageStory, ownStoryPageStory, saveStoryPageStory } from '@/features/photos/story-page';
import { isHoneypotFilled, honeypotField } from '@/lib/honeypot';
import { clientIp, jsonError, noStore, sameOrigin } from '@/lib/http';
import { hit, limitByIp } from '@/lib/ratelimit';
import { verifyTurnstile } from '@/lib/turnstile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().max(5000).optional(),
  consent: z.boolean().default(false),
  before60Answer: z.string().trim().max(2000).optional(),
  hp: honeypotField,
  turnstileToken: z.string().max(4096).optional(),
}); // unknown keys (a storyId in the body) are stripped and ignored on purpose

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return noStore(jsonError(403, 'bad_origin', ERRORS.generic));
  const limited = await limitByIp(req, 'storySave');
  if (limited) return noStore(limited);
  const gate = await requireInvite();
  if ('response' in gate) return noStore(gate.response);
  const { invite } = gate;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return noStore(jsonError(400, 'invalid', ERRORS.generic));
  const { hp, turnstileToken, ...fields } = parsed.data;
  const story = { ...fields, spam: isHoneypotFilled(hp) }; // AD-9: stored, same answer

  const capability = await readStoryPageCapability();
  const ownId = capability ? await ownStoryPageStory(capability, invite.id) : null;
  if (ownId) {
    await saveStoryPageStory(ownId, invite, story);
    return noStore(NextResponse.json({ ok: true }));
  }

  if (invite.kind === 'general' && !(await verifyTurnstile(turnstileToken, clientIp(req))))
    return noStore(jsonError(400, 'bot_check', ERRORS.botCheck));
  if (!(await hit('storyPageNew', invite.id)))
    return noStore(jsonError(429, 'rate_limited', ERRORS.rateLimited));
  const storyId = await createStoryPageStory(invite, story, STORY_PAGE_MAX_PER_INVITE[invite.kind]);
  if (!storyId) return noStore(jsonError(429, 'rate_limited', ERRORS.rateLimited));
  const res = noStore(NextResponse.json({ ok: true }));
  // pr43 F3: issued once per story, so its 2 hours run from the FIRST save (a later save never slides them).
  setStoryCapability(res, storyId);
  return res;
}
