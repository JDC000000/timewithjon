// src/app/api/admin/email/route.ts — T3.2.07/.08: GET → the "Email limit reached" banner, the "budget hit two
// days running" flag, the failed sends (each with a Resend action) and whether bounce polling is off (pr34 M1). Behind FEATURE_ADMIN_AUTH + requireAdmin
// (AD-7). The admin UI (T3.2.U1) reads it. Never cached.
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/features/admin/auth';
import { bouncePollStatus } from '@/features/email/bounce-poll';
import { budgetHitTwoDaysRunning, emailLimit, failedEmails } from '@/features/email/status';
import { noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const now = new Date();
  const [limit, hitTwoDaysRunning, failed, bouncePolling] = await Promise.all([
    emailLimit(now),
    budgetHitTwoDaysRunning(now),
    failedEmails(),
    bouncePollStatus(),
  ]);
  return noStore(
    NextResponse.json({ ok: true, limit, budgetHitTwoDaysRunning: hitTwoDaysRunning, failed, bouncePolling }),
  );
}
