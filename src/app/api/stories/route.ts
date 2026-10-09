// src/app/api/stories/route.ts — T1.8 After-Send story save. request_id comes ONLY from twj_req or a manage token (C2, T2.7.06).
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { readStoryCapability } from '@/features/invites/capability';
import { isHoneypotFilled, honeypotField } from '@/lib/honeypot';
import { BODY_TOO_LARGE, jsonError, readJson, sameOrigin, tooLarge } from '@/lib/http';
import { limitByIp } from '@/lib/ratelimit';
import { saveAfterSendStory } from '@/features/photos/after-send';

export const runtime = 'nodejs';
const Body = z.object({
  body: z.string().trim().max(5000).optional(),
  consent: z.boolean().default(false),
  before60Answer: z.string().trim().max(2000).optional(),
  hp: honeypotField,
}); // unknown keys (e.g. a request_id in the body) are stripped and ignored on purpose (T1.8 AC2)

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return jsonError(403, 'bad_origin', ERRORS.generic);
  const limited = await limitByIp(req, 'storySave');
  if (limited) return limited;
  const requestId = await readStoryCapability(req);
  if (!requestId) return jsonError(403, 'capability_expired', ERRORS.stale);
  const body = await readJson(req); // bounded: a body over MAX_JSON_BYTES is never read whole
  if (body === BODY_TOO_LARGE) return tooLarge(ERRORS.generic);
  const parsed = Body.safeParse(body);
  if (!parsed.success) return jsonError(400, 'invalid', ERRORS.generic);
  const { hp, ...story } = parsed.data;
  await saveAfterSendStory(requestId, { ...story, spam: isHoneypotFilled(hp) }); // AD-9: stored, same answer
  return NextResponse.json({ ok: true });
}
