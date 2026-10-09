// src/app/api/admin/auth/start/route.ts — T2.1.03 + T2.1.08: the one door for admin sign-in emails (AD-7).
// Public (there's no session yet), but same-origin only. Turnstile and the per-IP limit run the same way for
// every address; then the same 200 goes out at once and the allowlist, the per-address limit, the slot and the
// Supabase call run in after(), so neither the answer nor its timing tells anyone which address is the admin's
// (review F12). A start from the admin's known device skips the per-address limit and may use the kept slots.
import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { adminFeatureOff } from '@/features/admin/auth';
import { isKnownDevice, KNOWN_DEVICE_COOKIE } from '@/features/admin/known-device';
import { keepNext } from '@/features/admin/next-cookie';
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
  /** EML-11: the admin page to return to after the emailed link (kept only when safe, next-path.ts). */
  next: z.string().max(512).optional(),
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
    // Read now (the request is gone in after()); the answer is the same either way.
    const knownDevice = isKnownDevice(req.cookies.get(KNOWN_DEVICE_COOKIE)?.value, email);
    after(async () => {
      try {
        await sendAdminSignIn(email, undefined, knownDevice);
      } catch (e) {
        report(e, { area: 'admin_signin' });
      }
    });
  }
  // The same answer for every address, with the page to return to kept for this browser's emailed link.
  const res = NextResponse.json({ ok: true });
  keepNext(res, parsed.data.next);
  return res;
}
