// src/app/api/admin/auth/start/route.ts — T2.1.03 + T2.1.08: the one door for admin sign-in emails (AD-7).
// Public (there's no session yet), but same-origin only. Turnstile and the per-IP limit run the same way for
// every address; then the same 200 goes out at once and the allowlist, slot and Supabase call run in after(),
// so neither the answer nor its timing tells anyone which address is the admin's (review F12).
import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { adminFeatureOff } from '@/features/admin/auth';
import { sendAdminSignIn } from '@/features/admin/signin';
import { BODY_TOO_LARGE, clientIp, jsonError, readJson, sameOrigin, tooLarge } from '@/lib/http';
import { check } from '@/lib/ratelimit';
import { SIGN_IN } from '@/content/ui/admin-requests';
import { report } from '@/lib/report';
import { verifyTurnstile } from '@/lib/turnstile';
import { TURNSTILE_ACTION } from '@/lib/turnstile-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const StartBody = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  turnstileToken: z.string().max(2048).optional(),
});

export async function POST(req: NextRequest) {
  const off = adminFeatureOff();
  if (off) return off;
  if (!sameOrigin(req)) return jsonError(403, 'bad_origin', ERRORS.generic);
  const body = await readJson(req); // bounded: a body over MAX_JSON_BYTES is never read whole
  if (body === BODY_TOO_LARGE) return tooLarge(ERRORS.generic);
  const parsed = StartBody.safeParse(body);
  if (!parsed.success) return jsonError(400, 'invalid', ERRORS.generic);

  const ip = clientIp(req);
  if (!(await verifyTurnstile(parsed.data.turnstileToken, ip, TURNSTILE_ACTION.signIn))) {
    return jsonError(400, 'bot_check', ERRORS.botCheck);
  }
  const verdict = await check('adminSignInStart', ip);
  // Fail closed (security review 2026-09-30): no limiter, no email. Same answer for every address.
  if (verdict === 'unavailable') return jsonError(503, 'unavailable', SIGN_IN.unavailable);
  if (verdict === 'allowed') {
    const { email } = parsed.data;
    after(async () => {
      try {
        await sendAdminSignIn(email);
      } catch (e) {
        report(e, { area: 'admin_signin' });
      }
    });
  }
  return NextResponse.json({ ok: true });
}
