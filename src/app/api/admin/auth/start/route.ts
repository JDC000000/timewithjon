// src/app/api/admin/auth/start/route.ts — T2.1.03 + T2.1.08: the one door for admin sign-in emails (AD-7).
// Public (there's no session yet), but same-origin only. Turnstile and the per-IP limit run the same way for
// every address; then the same 200 goes out at once and the allowlist, slot and Supabase call run in after(),
// so neither the answer nor its timing tells anyone which address is the admin's (review F12).
import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { adminFeatureOff } from '@/features/admin/auth';
import { sendAdminSignIn } from '@/features/admin/signin';
import { clientIp, jsonError, sameOrigin } from '@/lib/http';
import { hit } from '@/lib/ratelimit';
import { report } from '@/lib/report';
import { verifyTurnstile } from '@/lib/turnstile';

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
  const parsed = StartBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid', ERRORS.generic);

  const ip = clientIp(req);
  if (!(await verifyTurnstile(parsed.data.turnstileToken, ip))) {
    return jsonError(400, 'bot_check', ERRORS.botCheck);
  }
  if (await hit('adminSignInStart', ip)) {
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
