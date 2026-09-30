// src/app/api/admin/auth/signout/route.ts — T2.1.06 (T2.1 AC6). Proto and staging (free org) can't have the
// 30-day inactivity timeout, so Sign out ends EVERY session of the admin: a refresh token from another device
// stops working too (TSD AD-7). The admin menu's "Sign out" (UI, after G1) posts here.
import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@/config/env';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { adminAuthClient } from '@/features/admin/supabase';
import { jsonError } from '@/lib/http';
import { report } from '@/lib/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const client = await adminAuthClient();
  const { error } = await client.auth.signOut({ scope: 'global' });
  if (error) {
    // The other sessions may still be alive, so don't pretend it worked. This browser is signed out regardless.
    report(error, { area: 'admin_signout' });
    await client.auth.signOut({ scope: 'local' });
    return jsonError(502, 'signout_failed', ERRORS.generic);
  }
  return NextResponse.redirect(new URL('/admin/sign-in', getEnv().NEXT_PUBLIC_SITE_URL), 303);
}
