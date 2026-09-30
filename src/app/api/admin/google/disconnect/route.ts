// src/app/api/admin/google/disconnect/route.ts — T3.3.05: A7 "Disconnect". Revokes the grant at Google and
// forgets the token; calendar_id stays, so Reconnect (GET /api/admin/google/connect) reuses the same calendar.
import { NextResponse, type NextRequest } from 'next/server';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { disconnectGoogle, GoogleRevokeUnavailableError } from '@/features/calendar/connection';
import { jsonError, noStore } from '@/lib/http';
import { report } from '@/lib/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  let revoked: boolean;
  try {
    ({ revoked } = await disconnectGoogle());
  } catch (e) {
    report(e, { area: 'google_disconnect' });
    // Google couldn't be told (5xx/429/timeout): the grant stays stored and live, so Jon retries (pr35 F5).
    if (e instanceof GoogleRevokeUnavailableError) {
      return noStore(jsonError(503, 'revoke_unavailable', ERRORS.generic));
    }
    return noStore(jsonError(500, 'disconnect_failed', ERRORS.generic));
  }
  // revoked=false: the token is forgotten but Google never heard (lost key); A7 links Jon to Google's permissions.
  return noStore(NextResponse.json({ ok: true, revoked }));
}
