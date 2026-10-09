// src/app/api/photos/finalise/route.ts — T3.6.03: re-encode one upload, keyed ONLY by its photo_upload id and
// checked against the caller's own story (AC6; twj_req or a manage token, like sign). Only successful finalises count toward the 20/h limit (AD-9).
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { callerStoryForFinalise } from '@/features/photos/caller-story';
import { finalisePhotoUpload } from '@/features/photos/finalise';
import { photoStore } from '@/lib/adapters/photos';
import { BODY_TOO_LARGE, clientIp, jsonError, noStore, readJson, sameOrigin, tooLarge } from '@/lib/http';
import { hit, overLimitByIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // HEIC conversion of a 12 MP photo takes a few seconds

const Body = z.object({ photoUploadId: z.uuid() });
const REFUSED = {
  not_found: [404, ERRORS.stale],
  not_uploaded: [409, ERRORS.generic],
  too_big: [413, ERRORS.generic],
  unreadable: [422, ERRORS.generic],
  too_many: [409, ERRORS.generic],
  // Every decode slot on this instance stayed taken (decode-gate.ts): nothing was refused, so the uploader's own
  // retry of a 5xx finalises the same upload a moment later.
  busy: [503, ERRORS.generic],
} as const;

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return noStore(jsonError(403, 'bad_origin', ERRORS.generic));
  const limited = await overLimitByIp(req, 'photoFinalise');
  if (limited) return noStore(limited);
  const caller = await callerStoryForFinalise(req);
  if ('response' in caller) return noStore(caller.response);
  const body = await readJson(req); // bounded: a body over MAX_JSON_BYTES is never read whole
  if (body === BODY_TOO_LARGE) return noStore(tooLarge(ERRORS.generic));
  const parsed = Body.safeParse(body);
  if (!parsed.success) return noStore(jsonError(400, 'invalid', ERRORS.generic));
  if (!caller.storyId) return noStore(jsonError(404, 'not_found', ERRORS.stale));
  const out = await finalisePhotoUpload(parsed.data.photoUploadId, caller.storyId, photoStore());
  if (!out.ok) {
    const [status, message] = REFUSED[out.code];
    const res = jsonError(status, out.code, message);
    if (out.code === 'busy') res.headers.set('Retry-After', '2');
    return noStore(res);
  }
  if (!out.replay) await hit('photoFinalise', clientIp(req));
  return noStore(NextResponse.json({ ok: true, photoId: out.photoId }));
}
