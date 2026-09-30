// src/app/api/admin/google/connect/route.ts — T3.3.03: A7 "Connect Google" (and Reconnect) starts here.
// Redirects to Google's consent screen with the G3 scopes, offline access and prompt=consent. The state and
// the PKCE verifier ride in a short-lived httpOnly cookie scoped to the callback.
import { NextResponse, type NextRequest } from 'next/server';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { startConnect, STATE_COOKIE, STATE_COOKIE_OPTIONS } from '@/features/calendar/connection';
import { googleConfigured } from '@/lib/adapters/google/oauth';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  if (!googleConfigured()) return jsonError(404, 'not_found', ERRORS.generic);

  const { url, cookie } = startConnect();
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(STATE_COOKIE, cookie, STATE_COOKIE_OPTIONS);
  return noStore(res);
}
