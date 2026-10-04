// src/app/api/story-page/route.ts — T3.12.01 (F27, S19): save a story without a booking. A valid invite is
// required (AC2); the story id comes ONLY from the twj_story capability, never the body. AD-9 order:
// Origin → per-IP limit → invite → body; a filled honeypot is stored as spam_suspect with the same answer.
// The first save of a page view creates a story, so it carries the general invite's Turnstile token (as
// /api/requests does) and counts toward the invite's daily limit; there is no total (Jon, 2026-10-04). QA r2 H1:
// only a save the form marks `edit` (a later save in the same page view) updates the story twj_story names, so a
// fresh /story within the cookie's 2 hours starts a new story instead of overwriting the last one.
// The first save carries the page view's clientKey, so a retry whose answer was lost gets the same story.
// M4: on the general link the guest may give a name (the booking form's rules); a personal link uses its own.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { readStoryPageCapability, setStoryCapability } from '@/features/invites/capability';
import { requireInvite } from '@/features/invites/require';
import { singleLine } from '@/features/requests/schema';
import {
  createStoryPageStory,
  ownStoryPageStory,
  saveStoryPageStory,
  storyPageStoryByKey,
} from '@/features/photos/story-page';
import { isHoneypotFilled, honeypotField } from '@/lib/honeypot';
import { clientIp, jsonError, noStore, sameOrigin } from '@/lib/http';
import { hit, limitByIp } from '@/lib/ratelimit';
import { verifyTurnstile } from '@/lib/turnstile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  name: singleLine(80).min(1).optional(),
  body: z.string().trim().max(5000).optional(),
  consent: z.boolean().default(false),
  before60Answer: z.string().trim().max(2000).optional(),
  hp: honeypotField,
  turnstileToken: z.string().max(4096).optional(),
  /** A later save in the same page view: update this page's story (from twj_story), never start another. */
  edit: z.boolean().default(false),
  /** The page view's key: a retried first save (its answer lost) gets the same story, never a second one. */
  clientKey: z.uuid().optional(),
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
  const { hp, turnstileToken, edit, clientKey, name, ...fields } = parsed.data;
  // AD-9: a filled honeypot is stored, same answer. A personal link's story is named by its invite (M4).
  const story = { ...fields, name: invite.kind === 'general' ? name : undefined, spam: isHoneypotFilled(hp) };

  if (edit) {
    // An edit never creates: its story (from twj_story only) is this invite's, or the answer is the stale line
    // (the capability ran out, or Jon deleted the story, even between this check and the update).
    const capability = await readStoryPageCapability();
    const ownId = capability ? await ownStoryPageStory(capability, invite.id) : null;
    if (!ownId || !(await saveStoryPageStory(ownId, invite, story))) return noStore(expired());
    return noStore(NextResponse.json({ ok: true }));
  }

  // A retried first save of this page view: its story already exists. Update it and hand back its twj_story,
  // before the Turnstile check and the daily limit (a retry spends neither).
  const made = clientKey ? await storyPageStoryByKey(clientKey, invite.id) : null;
  if (made) {
    if (!(await saveStoryPageStory(made, invite, story))) return noStore(expired());
    return withStory(made);
  }

  if (invite.kind === 'general' && !(await verifyTurnstile(turnstileToken, clientIp(req))))
    return noStore(jsonError(400, 'bot_check', ERRORS.botCheck));
  if (!(await hit('storyPageNew', invite.id)))
    return noStore(jsonError(429, 'rate_limited', ERRORS.rateLimited));
  const storyId = await createStoryPageStory(invite, story, clientKey ?? null);
  if (!storyId) return noStore(jsonError(409, 'key_reused', ERRORS.generic)); // another invite's key
  return withStory(storyId);
}

/** ok, with the story's twj_story (pr43 F3: issued when the story is made, or handed back to its retry). */
function withStory(storyId: string): NextResponse {
  const res = noStore(NextResponse.json({ ok: true }));
  setStoryCapability(res, storyId);
  return res;
}

const expired = () => jsonError(403, 'capability_expired', ERRORS.stale);
