// src/app/api/story-page/route.ts — T3.12.01 (F27, S19): save a story without a booking. A valid invite is
// required (AC2); the story id comes ONLY from the twj_story capability, never the body. AD-9 order:
// Origin → per-IP limit → invite → body; a filled honeypot is stored as spam_suspect with the same answer.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { readStoryPageCapability, setStoryCapability } from '@/features/invites/capability';
import { requireInvite } from '@/features/invites/require';
import { saveStoryPageStory } from '@/features/photos/story-page';
import { isHoneypotFilled, honeypotField } from '@/lib/honeypot';
import { jsonError, noStore, sameOrigin } from '@/lib/http';
import { limitByIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().max(5000).optional(),
  consent: z.boolean().default(false),
  before60Answer: z.string().trim().max(2000).optional(),
  hp: honeypotField,
}); // unknown keys (a storyId in the body) are stripped and ignored on purpose

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return noStore(jsonError(403, 'bad_origin', ERRORS.generic));
  const limited = await limitByIp(req, 'storySave');
  if (limited) return noStore(limited);
  const gate = await requireInvite();
  if ('response' in gate) return noStore(gate.response);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return noStore(jsonError(400, 'invalid', ERRORS.generic));
  const { hp, ...story } = parsed.data;
  const existingId = await readStoryPageCapability();
  const storyId = await saveStoryPageStory(existingId, gate.invite, {
    ...story,
    spam: isHoneypotFilled(hp), // AD-9: stored, same answer
  });
  const res = noStore(NextResponse.json({ ok: true }));
  // pr43 F3: issued once per story, so its 2 hours run from the FIRST save (a later save never slides them).
  if (storyId !== existingId) setStoryCapability(res, storyId);
  return res;
}
