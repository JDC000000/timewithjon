// src/app/api/admin/email/[id]/resend/route.ts — T3.2.08: POST → re-send one failed email as P1 (AD-5 rule 1).
// Behind FEATURE_ADMIN_AUTH + requireAdmin + the Origin check (AD-7). Only a 'failed' row can be re-sent;
// an .ics a newer one already replaced is refused with 409 'superseded' (pr58 F1).
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { resendFailedEmail } from '@/features/email/status';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Id = z.uuid();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const { id } = await ctx.params;
  // A malformed id is simply not found: no Postgres cast error.
  const result = Id.safeParse(id).success ? await resendFailedEmail(id) : 'not_found';
  if (result === 'not_found') return noStore(jsonError(404, 'not_found', ERRORS.generic));
  if (result === 'superseded') return noStore(jsonError(409, 'superseded', ERRORS.generic));
  return noStore(NextResponse.json({ ok: true, result }));
}
