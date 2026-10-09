// src/features/admin/next-cookie.ts — EML-11 for the emailed sign-in link: the admin page Jon was on ("Open the
// request" while signed out) is kept in a short-lived cookie when he asks for the email, and the link's "Sign me in"
// (POST /api/admin/auth/confirm) returns there. The email itself is unchanged. Opened in another browser (no
// cookie), the link lands on the inbox as before. Only a safe admin path is ever kept or followed (next-path.ts).
import 'server-only';
import type { NextResponse } from 'next/server';
import { getEnv } from '@/config/env';
import { safeAdminNext } from './next-path';

export const NEXT_COOKIE = 'twj_admin_next';
/** As long as the emailed code and link work (supabase/config.toml otp_expiry = 900). */
const NEXT_TTL_SECONDS = 15 * 60;
const options = (maxAge: number) => ({
  httpOnly: true,
  secure: getEnv().NEXT_PUBLIC_SITE_URL.startsWith('https'),
  sameSite: 'strict' as const,
  path: '/api/admin/auth',
  maxAge,
});

/** Keeps `next` for the link when it is a safe admin page other than the inbox; otherwise clears any kept one. */
export function keepNext(res: NextResponse, next: unknown): void {
  const safe = safeAdminNext(next);
  if (safe && safe !== '/admin') res.cookies.set(NEXT_COOKIE, safe, options(NEXT_TTL_SECONDS));
  else res.cookies.set(NEXT_COOKIE, '', options(0));
}

/** The kept page (checked again), or null. */
export function keptNext(cookie: string | undefined): string | null {
  return safeAdminNext(cookie);
}

export function clearNext(res: NextResponse): void {
  res.cookies.set(NEXT_COOKIE, '', options(0));
}
