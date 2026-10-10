// src/features/requests/lock-api.ts — T2.3.04 the shared handler for POST /api/admin/requests/[id]/lock
// (Change time removed 2026-09-29). requireAdmin (feature flag, Origin, session) → Zod → lockRequest → refusals as 409 with
// REFUSAL_MESSAGE (§6 "Lock race outcomes"). Dates mode is a date, a start time and a LENGTH (C3 rule 14:
// never all-day, end = start + length). Never cached.
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { jsonError, noStore } from '@/lib/http';
import { vancouverInstantOrNull } from '@/lib/time';
import { lockRequest, type LockTarget } from './lock';

export const MAX_LENGTH_MINUTES = 72 * 60; // an overnight weekend, with room to spare

const Flags = {
  overrideWeek: z.boolean().default(false), // "Override this week"
  bookAnyway: z.boolean().default(false), // "Book anyway"
};
/** A dates-mode time as Jon enters it: a Vancouver date, a start and a length (also T2.4's offered ranges). */
export const RangeFields = {
  date: z.iso.date(),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  lengthMinutes: z.number().int().min(15).max(MAX_LENGTH_MINUTES),
  where: z.string().trim().max(200).nullable().default(null),
};
export const LockBody = z.union([
  // TWJ11 (Jon, 2026-10-10): a one-click time lock may carry the place too (optional; empty = none, as before)
  z.strictObject({ slotId: z.uuid(), where: RangeFields.where, ...Flags }),
  z.strictObject({
    ...RangeFields,
    countsToward: z.enum(['weekly_cap', 'big_day', 'none']),
    ...Flags,
  }),
]);
export type LockBody = z.infer<typeof LockBody>;

/** Vancouver wall clock → a concrete range; null when that wall-clock time doesn't exist (a DST gap). */
export function targetFrom(b: LockBody): LockTarget | null {
  if ('slotId' in b) return { slotId: b.slotId, where: b.where || null };
  const r = rangeFrom(b);
  return r && { ...r, countsToward: b.countsToward };
}
export function rangeFrom(b: {
  date: string;
  start: string;
  lengthMinutes: number;
  where: string | null;
}): { startsAt: Date; endsAt: Date; where: string | null } | null {
  const startsAt = vancouverInstantOrNull(b.date, b.start);
  if (!startsAt) return null;
  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + b.lengthMinutes * 60_000),
    where: b.where || null,
  };
}

export async function handleLock(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
  mode: 'lock',
): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return noStore(jsonError(404, 'not_found', ERRORS.generic));
  const parsed = LockBody.safeParse(await req.json().catch(() => null));
  const target = parsed.success ? targetFrom(parsed.data) : null;
  if (!parsed.success || !target) return noStore(jsonError(400, 'invalid', ERRORS.generic));

  const res = await lockRequest({
    requestId: id,
    target,
    mode,
    overrideWeek: parsed.data.overrideWeek,
    bookAnyway: parsed.data.bookAnyway,
  });
  if (res.ok) return noStore(NextResponse.json({ ok: true, warnings: res.warnings }));
  if (res.status === 404) return noStore(jsonError(404, res.reason, ERRORS.generic));
  return noStore(jsonError(409, res.reason, res.message));
}
