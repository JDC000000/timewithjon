// src/features/requests/joined-api.ts — T2.10 the admin routes POST /api/admin/requests/[id]/join,
// /promote and /close-in-person. requireAdmin (feature flag, Origin, session) → Zod → the service → 409 with the
// refusal message. Never cached.
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { jsonError, noStore } from '@/lib/http';
import { closeInPerson } from './close-in-person';
import { joinToBooking, promoteToHost, type JoinResult } from './joined';

type Ctx = { params: Promise<{ id: string }> };

export const JoinBody = z.strictObject({ hostId: z.uuid() });
export const PromoteBody = z.strictObject({
  overrideWeek: z.boolean().default(false), // "Override this week"
  bookAnyway: z.boolean().default(false), // "Book anyway"
});
export const CloseBody = z.strictObject({});

/** requireAdmin, a uuid id and a valid body; else the Response to send. */
async function admit<S extends z.ZodType>(
  req: NextRequest,
  ctx: Ctx,
  schema: S,
): Promise<Response | { id: string; body: z.infer<S> }> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return noStore(jsonError(404, 'not_found', ERRORS.generic));
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return noStore(jsonError(400, 'invalid', ERRORS.generic));
  return { id, body: parsed.data };
}

function answer(res: JoinResult): Response {
  if (res.ok) return noStore(NextResponse.json({ ok: true, warnings: res.warnings }));
  if (res.status === 404) return noStore(jsonError(404, res.reason, ERRORS.generic));
  return noStore(jsonError(409, res.reason, res.message));
}

export async function handleJoin(req: NextRequest, ctx: Ctx): Promise<Response> {
  const a = await admit(req, ctx, JoinBody);
  if (a instanceof Response) return a;
  return answer(await joinToBooking(a.id, a.body.hostId));
}

export async function handlePromote(req: NextRequest, ctx: Ctx): Promise<Response> {
  const a = await admit(req, ctx, PromoteBody);
  if (a instanceof Response) return a;
  return answer(await promoteToHost(a.id, a.body));
}

export async function handleCloseInPerson(req: NextRequest, ctx: Ctx): Promise<Response> {
  const a = await admit(req, ctx, CloseBody);
  if (a instanceof Response) return a;
  const res = await closeInPerson(a.id);
  if (res.ok) return noStore(NextResponse.json({ ok: true, already: res.already }));
  if (res.status === 404) return noStore(jsonError(404, res.reason, ERRORS.generic));
  return noStore(jsonError(409, res.reason, res.message));
}
