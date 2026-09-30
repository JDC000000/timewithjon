// src/app/api/admin/requests/[id]/route.ts — T2.2.05: GET → one request's detail (TSD T2.2; A3 reads it).
// T2.8.01: PATCH { before60Note?, jonNote? } → Jon's notes (autosave). Behind FEATURE_ADMIN_AUTH + requireAdmin +
// the Origin check on PATCH (AD-7). "Sealed plan on file" only, never the plan (C4). Never cached.
import { NextResponse, type NextRequest } from 'next/server';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { getRequestDetail } from '@/features/admin/detail';
import { NotesPatch, updateNotes } from '@/features/admin/notes';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);

  const { id } = await ctx.params;
  // A malformed id is simply not found: no Postgres cast error, no Sentry noise.
  const detail = UUID.test(id) ? await getRequestDetail(id) : null;
  if (!detail) return noStore(jsonError(404, 'not_found', ERRORS.generic));
  return noStore(NextResponse.json({ ok: true, request: detail }));
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);

  const { id } = await ctx.params;
  if (!UUID.test(id)) return noStore(jsonError(404, 'not_found', ERRORS.generic));
  const parsed = NotesPatch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return noStore(jsonError(400, 'invalid', ERRORS.generic));
  const notes = await updateNotes(id, parsed.data);
  if (!notes) return noStore(jsonError(404, 'not_found', ERRORS.generic));
  return noStore(NextResponse.json({ ok: true, notes }));
}
