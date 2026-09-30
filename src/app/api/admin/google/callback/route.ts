// src/app/api/admin/google/callback/route.ts — T3.3.04: Google's redirect back after consent.
// state check → code exchange → the account must be ADMIN_EMAILS[0] (AC3) → the granted scopes must equal the
// G3 set (AC5) → "Time with Jon" is created only if no calendar is stored (AC4) → the token is stored encrypted.
// Every outcome lands on A7 with a short code; the code, the tokens and the email never reach a log or a URL.
import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@/config/env';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import {
  completeConnect,
  STATE_COOKIE,
  STATE_COOKIE_OPTIONS,
  verifierFor,
} from '@/features/calendar/connection';
import { googleConfigured } from '@/lib/adapters/google/oauth';
import { jsonError, noStore } from '@/lib/http';
import { report } from '@/lib/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One value per parameter: a repeated `state` or `code` is refused rather than silently taking the first. */
function single(req: NextRequest, name: string): string | null {
  const all = req.nextUrl.searchParams.getAll(name);
  return all.length === 1 ? (all[0] ?? null) : null;
}

function toSettings(result: string): NextResponse {
  const res = NextResponse.redirect(
    new URL(`/admin/settings?google=${result}`, getEnv().NEXT_PUBLIC_SITE_URL),
    303,
  );
  res.cookies.set(STATE_COOKIE, '', { ...STATE_COOKIE_OPTIONS, maxAge: 0 });
  return noStore(res);
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  if (!googleConfigured()) return jsonError(404, 'not_found', ERRORS.generic);

  const verifier = verifierFor(req.cookies.get(STATE_COOKIE)?.value, single(req, 'state') ?? '');
  if (!verifier) return toSettings('expired');
  if (req.nextUrl.searchParams.has('error')) return toSettings('cancelled'); // Jon said no on Google's screen
  const code = single(req, 'code');
  if (!code) return toSettings('failed');

  try {
    const result = await completeConnect(code, verifier);
    return toSettings(result.ok ? 'connected' : result.reason);
  } catch (e) {
    report(e, { area: 'google_connect' });
    return toSettings('failed');
  }
}
