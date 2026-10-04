// src/app/api/events/route.ts — T3.11.01: the browser reports the two events the server never sees (the dish
// sheet and the picker open client-side). Counts only: nothing about the visitor is stored. Order: Origin, then
// the per-IP limit, then the body (T3.8). Not a form (no typed fields), so no honeypot. Bots count nothing (204).
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { BEACON_EVENTS, countEvent } from '@/features/analytics/count';
import { isPreviewBot } from '@/features/invites/bots';
import { jsonError, sameOrigin } from '@/lib/http';
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
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BEACON_BYTES)
    return jsonError(413, 'too_large', ERRORS.generic);
  const text = await readAtMost(req, MAX_BEACON_BYTES);
  if (text === null) return jsonError(413, 'too_large', ERRORS.generic);
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return jsonError(400, 'invalid', ERRORS.generic);
  if (!isPreviewBot(req.headers.get('user-agent'), req.method)) await countEvent(parsed.data.name);
  return new Response(null, { status: 204 });
}

/** The body as text, or null once it passes `max` bytes: a chunked body (no Content-Length) is never buffered whole. */
async function readAtMost(req: NextRequest, max: number): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
