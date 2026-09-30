// src/app/api/photos/sign/route.ts — T3.6.02: a one-time signed upload URL for `incoming/<photo_upload.id>`.
// The story comes ONLY from capabilities (C2): twj_req or a manage token, or with ?for=story_page a valid invite +
// twj_story (T3.12.01; features/photos/caller-story). The file goes straight to Storage, never
// through this function. Prototype stores nothing (§5.5): it answers { mock: true } and the picker keeps its preview.
import { NextResponse, type NextRequest } from 'next/server';
import { ERRORS } from '@/content';
import { callerStoryForSign } from '@/features/photos/caller-story';
import { signPhotoUpload } from '@/features/photos/sign';
import { photoStore } from '@/lib/adapters/photos';
import { jsonError, noStore, sameOrigin } from '@/lib/http';
import { limitByIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return noStore(jsonError(403, 'bad_origin', ERRORS.generic));
  const limited = await limitByIp(req, 'photoSign');
  if (limited) return noStore(limited);
  const caller = await callerStoryForSign(req);
  if ('response' in caller) return noStore(caller.response);
  const { storyId } = caller;
  if (!storyId) return noStore(jsonError(403, 'capability_expired', ERRORS.stale));
  const out = await signPhotoUpload(storyId, photoStore());
  if (out.ok) {
    const { uploadId, signedUrl, token, path } = out;
    return noStore(NextResponse.json({ ok: true, uploadId, signedUrl, token, path }));
  }
  if (out.code === 'not_stored') return noStore(NextResponse.json({ mock: true }));
  // The picker offers only 2, so this is a replayed or scripted call: the generic line (no new copy).
  if (out.code === 'too_many') return noStore(jsonError(409, 'too_many_photos', ERRORS.generic));
  return noStore(jsonError(403, 'capability_expired', ERRORS.stale));
}
