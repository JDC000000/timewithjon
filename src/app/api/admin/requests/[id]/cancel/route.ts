// src/app/api/admin/requests/[id]/cancel/route.ts — T2.9.03: POST → Jon's "Cancel for the guest" in A3 (TSD T2.9
// AC3, §6): cancelled, the event deleted (a joined guest only leaves the host's event), live offers released,
// E11 to the guest and no E12. Behind FEATURE_ADMIN_AUTH + requireAdmin + the Origin check (AD-7). Idempotent:
// a second call answers ok with already=true; a booking that has already ended is 409 already_done.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { cancelForGuest } from '@/features/requests/guest-cancel';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return noStore(jsonError(404, 'not_found', ERRORS.generic));
  const res = await cancelForGuest(id);
  if (res.ok) return noStore(NextResponse.json({ ok: true, already: res.already }));
  if (res.status === 404) return noStore(jsonError(404, 'not_found', ERRORS.generic));
  return noStore(jsonError(409, res.reason, ERRORS.generic));
}
