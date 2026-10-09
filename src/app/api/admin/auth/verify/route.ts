// src/app/api/admin/auth/verify/route.ts — T2.1.04 (T2.1 AC3): the 6-digit code signs in within the same tab.
// Public (there's no session yet), same-origin only, limited per IP; wrong codes are also counted per address.
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { adminFeatureOff } from '@/features/admin/auth';
import { completeSignIn } from '@/features/admin/verify';
import { BODY_TOO_LARGE, clientIp, jsonError, noStore, readJson, sameOrigin, tooLarge } from '@/lib/http';
import { check, peek, type LimitVerdict } from '@/lib/ratelimit';
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
  const body = await readJson(req); // bounded: a body over MAX_JSON_BYTES is never read whole
  if (body === BODY_TOO_LARGE) return tooLarge(ERRORS.generic);
  const parsed = VerifyBody.safeParse(body);
  if (!parsed.success) return jsonError(400, 'invalid', ERRORS.generic);
  // Per IP: every attempt counts (fail closed: if the limiter can't count, no code is checked at all).
  const verdict: LimitVerdict = await check('adminSignInVerify', clientIp(req));
  if (verdict === 'unavailable') return jsonError(503, 'unavailable', SIGN_IN.unavailable);
  if (verdict === 'limited') return jsonError(429, 'rate_limited', ERRORS.rateLimited);
  // Per address: only WRONG codes count (below), so a few stray attempts never refuse the admin's code. Once the
  // address has had LIMITS.adminSignInVerifyEmail wrong codes this hour, no typed code is checked for it until the
  // hour ends (so the code can't be guessed from many IPs); the emailed link still signs in.
  const address = await peek('adminSignInVerifyEmail', emailKey(parsed.data.email));
  if (address === 'unavailable') return jsonError(503, 'unavailable', SIGN_IN.unavailable);
  if (address === 'limited') return jsonError(429, 'rate_limited', ERRORS.rateLimited);
  const result = await completeSignIn(parsed.data);
  if (!result.ok) {
    // Review guarantee 5: a verified user who is off the allowlist gets 401 (their session is already dropped).
    if (result.reason === 'not_admin') return jsonError(401, 'unauthorized', ERRORS.generic);
    const wrong = await check('adminSignInVerifyEmail', emailKey(parsed.data.email));
    if (wrong === 'limited') return jsonError(429, 'rate_limited', ERRORS.rateLimited);
    return jsonError(400, 'invalid_code', ERRORS.generic);
  }
  return NextResponse.json({ ok: true });
}
