// src/app/api/admin/stories/email-in/route.ts — T3.7.02: A6 "Add emailed story". Admin only (FEATURE_ADMIN_AUTH +
// requireAdmin, Origin on the write, AD-7). Saves source `email_in`; sends nothing (T3.7 AC3). Idempotent on the
// optional Idempotency-Key header (pr82-review F5): a replay answers the same 201 with the story already made; the
// same key with another payload is refused with 409 and changes nothing (pr83-review M1).
import { NextResponse, type NextRequest } from 'next/server';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import {
  addEmailedStory,
  EmailedStoryBody,
  IDEMPOTENCY_HEADER,
  IdempotencyKey,
  KEY_REUSED,
} from '@/features/photos/email-in';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const rawKey = req.headers.get(IDEMPOTENCY_HEADER);
  const key = rawKey === null ? null : IdempotencyKey.safeParse(rawKey);
  const parsed = EmailedStoryBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (key && !key.success)) return noStore(jsonError(400, 'invalid', ERRORS.generic));
  const storyId = await addEmailedStory(parsed.data, key?.data ?? null);
  if (storyId === KEY_REUSED) return noStore(jsonError(409, KEY_REUSED, ERRORS.generic));
  return noStore(NextResponse.json({ ok: true, storyId }, { status: 201 }));
}
