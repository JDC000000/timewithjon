// src/features/admin/auth.ts — T2.1.02 requireAdmin(): inside every admin page and /api/admin/** handler (AD-7).
import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/config/env';
import { ERRORS } from '@/content';
import { jsonError, sameOrigin } from '@/lib/http';
import { currentAuthEmail } from './supabase';

/** TSD waiver: M2 server logic ships behind a flag. While FEATURE_ADMIN_AUTH is unset, admin routes don't exist. */
export function adminFeatureOff(): NextResponse | null {
  return getEnv().FEATURE_ADMIN_AUTH === '1' ? null : jsonError(404, 'not_found', ERRORS.generic);
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);

export function isAdminEmail(email: string): boolean {
  return getEnv().ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * Returns the admin's email, or the response to send. Pages call it with no request (a GET).
 * The Origin check runs first, so a cross-site write is refused without a call to the Auth server.
 */
export async function requireAdmin(req?: NextRequest): Promise<{ email: string } | NextResponse> {
  const off = adminFeatureOff();
  if (off) return off;
  if (req && !SAFE_METHODS.has(req.method) && !sameOrigin(req)) {
    return jsonError(403, 'bad_origin', ERRORS.generic);
  }
  const email = await currentAuthEmail();
  if (!email || !isAdminEmail(email)) return jsonError(401, 'unauthorized', ERRORS.generic);
  return { email };
}
