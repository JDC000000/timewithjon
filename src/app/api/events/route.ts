// src/app/api/events/route.ts — T3.11.01: the browser reports the two events the server never sees (the dish
// sheet and the picker open client-side). Counts only: nothing about the visitor is stored. Order: Origin, then
// the per-IP limit, then the body (T3.8). Not a form (no typed fields), so no honeypot. Bots count nothing (204).
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { BEACON_EVENTS, countEvent } from '@/features/analytics/count';
import { isPreviewBot } from '@/features/invites/bots';
import { BODY_TOO_LARGE, jsonError, readJson, sameOrigin, tooLarge } from '@/lib/http';
import { limitByIp } from '@/lib/ratelimit';
import { ERRORS } from '@/content';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ name: z.enum(BEACON_EVENTS) });
/** pr42 F4: the body is `{"name":"dish_sheet_opened"}`; anything much bigger is refused before any parsing. */
export const MAX_BEACON_BYTES = 256;

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return jsonError(403, 'bad_origin', ERRORS.generic);
  const limited = await limitByIp(req, 'eventBeacon');
  if (limited) return limited;
  const json = await readJson(req, MAX_BEACON_BYTES);
  if (json === BODY_TOO_LARGE) return tooLarge(ERRORS.generic);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return jsonError(400, 'invalid', ERRORS.generic);
  if (!isPreviewBot(req.headers.get('user-agent'), req.method)) await countEvent(parsed.data.name);
  return new Response(null, { status: 204 });
}
