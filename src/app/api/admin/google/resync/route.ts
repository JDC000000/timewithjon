// src/app/api/admin/google/resync/route.ts — T3.15.02: A7 "Re-sync calendar" (TSD T3.15, L10). Behind
// FEATURE_ADMIN_AUTH + requireAdmin + the Origin check (AD-7). Idempotent: a second press converges, never duplicates.
import { NextResponse, type NextRequest } from 'next/server';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { GoogleNotConnectedError } from '@/features/calendar/connection';
import { resyncCalendar } from '@/features/calendar/resync';
import { jsonError, noStore } from '@/lib/http';
import { report } from '@/lib/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // rows start within 20 s, Google calls stop at 45 s (resync.ts); the tick does the rest

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin); // pr57 F6
  try {
    return noStore(NextResponse.json({ ok: true, ...(await resyncCalendar()) }));
  } catch (e) {
    if (e instanceof GoogleNotConnectedError) {
      return noStore(jsonError(409, 'not_connected', ERRORS.generic));
    }
    report(e, { area: 'calendar_resync' });
    return noStore(jsonError(500, 'resync_failed', ERRORS.generic));
  }
}
