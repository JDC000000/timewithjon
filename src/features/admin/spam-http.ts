// src/features/admin/spam-http.ts — T2.9.04: the one handler body behind the four "Check these" routes
// (requests/stories × Not spam/Delete). requireAdmin + the Origin check first (AD-7), never cached.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { jsonError, noStore } from '@/lib/http';
import type { DeleteRequestResult, StorySpamResult } from './spam';

/**
 * 404 unknown or malformed id; 409 `not_spam_suspect` (a real row is never deleted, AC4), `has_photos`, or
 * `not_deletable` (a spam suspect that went further than a request, pr47 F1).
 */
export async function spamAction(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
  act: (id: string) => Promise<StorySpamResult | DeleteRequestResult>,
): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  // pr53 F1: z.uuid() takes UPPERCASE too, and the audit detail keys take lowercase only: one canonical form.
  const id = (await ctx.params).id.toLowerCase();
  if (!z.uuid().safeParse(id).success) return noStore(jsonError(404, 'not_found', ERRORS.generic));
  const result = await act(id);
  if (result === 'not_found') return noStore(jsonError(404, 'not_found', ERRORS.generic));
  if (result === 'not_spam') return noStore(jsonError(409, 'not_spam_suspect', ERRORS.generic));
  if (result === 'has_photos') return noStore(jsonError(409, 'has_photos', ERRORS.generic));
  if (result === 'not_deletable') return noStore(jsonError(409, 'not_deletable', ERRORS.generic));
  return noStore(NextResponse.json({ ok: true }));
}
