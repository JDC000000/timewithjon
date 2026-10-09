// src/app/api/admin/stories/[id]/photos/sign/route.ts — T3.7.03: a signed upload for one of up to 5 photos on
// Jon's emailed story (the T3.6 pipeline; MAX_PHOTOS.email_in). Admin only; the one-time token is never cached.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { isEmailedStory } from '@/features/photos/email-in';
import { signPhotoUpload } from '@/features/photos/sign';
import { photoStore } from '@/lib/adapters/photos';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success || !(await isEmailedStory(id)))
    return noStore(jsonError(404, 'not_found', ERRORS.generic));
  const out = await signPhotoUpload(id, photoStore());
  if (out.ok) {
    const { uploadId, signedUrl, token, path } = out;
    return noStore(NextResponse.json({ ok: true, uploadId, signedUrl, token, path }));
  }
  if (out.code === 'not_stored') return noStore(NextResponse.json({ mock: true }));
  if (out.code === 'too_many') return noStore(jsonError(409, 'too_many_photos', ERRORS.generic));
  if (out.code === 'too_many_attempts') return noStore(jsonError(409, 'too_many_attempts', ERRORS.generic));
  return noStore(jsonError(404, 'not_found', ERRORS.generic));
}
