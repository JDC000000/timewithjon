// src/app/api/admin/photos/route.ts — T3.6.07: GET ?storyId= → the story's photos as 10-minute signed URLs.
// Admin only (requireAdmin + FEATURE_ADMIN_AUTH); the URLs are never cached.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { storyPhotosForAdmin } from '@/features/photos/thumbnails';
import { photoStore } from '@/lib/adapters/photos';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin); // every answer of this route is uncached, refusals too
  const storyId = z.uuid().safeParse(req.nextUrl.searchParams.get('storyId'));
  if (!storyId.success) return noStore(jsonError(400, 'invalid', ERRORS.generic));
  return noStore(NextResponse.json({ photos: await storyPhotosForAdmin(storyId.data, photoStore()) }));
}
