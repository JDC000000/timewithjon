// src/app/api/admin/requests/[id]/lock-check/route.ts — QA4 H1: would this lock go through? Read only (no row is
// written or locked): the same body as /lock (a slot, or a date + start + length + counts as, and the ticks), the
// C3 rule 8 verdict back. requireAdmin (feature flag, Origin, session) as every admin route; never cached.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { checkLock } from '@/features/admin/lock-check';
import { LockBody, targetFrom } from '@/features/requests/lock-api';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return noStore(jsonError(404, 'not_found', ERRORS.generic));
  const parsed = LockBody.safeParse(await req.json().catch(() => null));
  const target = parsed.success ? targetFrom(parsed.data) : null;
  if (!parsed.success || !target) return noStore(jsonError(400, 'invalid', ERRORS.generic));
  const check = await checkLock(id, target, {
    overrideWeek: parsed.data.overrideWeek,
    bookAnyway: parsed.data.bookAnyway,
  });
  if (!check.ok && (check.reason === 'request_not_found' || check.reason === 'slot_not_found'))
    return noStore(jsonError(404, check.reason, ERRORS.generic));
  return noStore(NextResponse.json({ ok: true, check }));
}
