// src/app/api/admin/auth/verify/route.ts — T2.1.04 (T2.1 AC3): the 6-digit code signs in within the same tab.
// Public (there's no session yet), same-origin only, and limited per IP so a code can't be guessed.
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { adminFeatureOff } from '@/features/admin/auth';
import { completeSignIn } from '@/features/admin/verify';
import { clientIp, jsonError, noStore, sameOrigin } from '@/lib/http';
import { check, type LimitVerdict } from '@/lib/ratelimit';
import { SIGN_IN } from '@/content/ui/admin-requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VerifyBody = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: NextRequest) {
  const off = adminFeatureOff();
  if (off) return off;
  return noStore(await verifyCode(req));
}

/** The limiter key for an address: a hash, so the rate_limit table holds no email addresses. */
function emailKey(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

async function verifyCode(req: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(req)) return jsonError(403, 'bad_origin', ERRORS.generic);
  const parsed = VerifyBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid', ERRORS.generic);
  // Per IP, then per address (review F1): a pool of IPs still gets only 10 guesses at one address's code.
  let verdict: LimitVerdict = await check('adminSignInVerify', clientIp(req));
  if (verdict === 'allowed') verdict = await check('adminSignInVerifyEmail', emailKey(parsed.data.email));
  // Fail closed (security review 2026-09-30): if the limiter can't count, no code is checked at all.
  if (verdict === 'unavailable') return jsonError(503, 'unavailable', SIGN_IN.unavailable);
  if (verdict === 'limited') return jsonError(429, 'rate_limited', ERRORS.rateLimited);
  const result = await completeSignIn(parsed.data);
  if (!result.ok) {
    // Review guarantee 5: a verified user who is off the allowlist gets 401 (their session is already dropped).
    return result.reason === 'not_admin'
      ? jsonError(401, 'unauthorized', ERRORS.generic)
      : jsonError(400, 'invalid_code', ERRORS.generic);
  }
  return NextResponse.json({ ok: true });
}
