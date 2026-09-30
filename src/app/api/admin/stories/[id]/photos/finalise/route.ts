// src/app/api/admin/stories/[id]/photos/finalise/route.ts — T3.7.03: queue the re-encode of an uploaded photo on
// Jon's emailed story (outbox `attachment_finalise`, run by /api/jobs/media): 202. Already finalised: 200 + photoId.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { queueEmailedPhotoFinalise } from '@/features/photos/email-in';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ photoUploadId: z.uuid() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success)
    return noStore(jsonError(400, 'invalid', ERRORS.generic));
  const out = await queueEmailedPhotoFinalise(id, parsed.data.photoUploadId);
  if (!out.ok) return noStore(jsonError(404, 'not_found', ERRORS.generic));
  return noStore(NextResponse.json(out, { status: 'queued' in out ? 202 : 200 }));
}
