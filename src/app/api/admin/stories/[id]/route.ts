// src/app/api/admin/stories/[id]/route.ts — T2.9.01: PATCH { consent } = Jon's consent toggle, recorded as
// consent_source='jon' (TSD T2.9 AC1); 409 `spam_suspect` until the story is marked "Not spam". Behind FEATURE_ADMIN_AUTH + requireAdmin + the Origin check (AD-7).
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { setStoryConsent } from '@/features/admin/stories';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.strictObject({ consent: z.boolean() });

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  // pr53 F1: z.uuid() takes UPPERCASE too, and the audit's story_id takes lowercase only: one canonical form.
  const id = (await ctx.params).id.toLowerCase();
  if (!z.uuid().safeParse(id).success) return noStore(jsonError(404, 'not_found', ERRORS.generic));
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return noStore(jsonError(400, 'invalid', ERRORS.generic));
  const result = await setStoryConsent(id, parsed.data.consent);
  if (result === 'not_found') return noStore(jsonError(404, 'not_found', ERRORS.generic));
  if (result === 'spam') return noStore(jsonError(409, 'spam_suspect', ERRORS.generic));
  return noStore(NextResponse.json({ ok: true }));
}
