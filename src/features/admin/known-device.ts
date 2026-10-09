// src/features/admin/known-device.ts — the admin's "known device": a signed cookie set when a sign-in succeeds (the
// typed code or the emailed link). A start from that browser skips the per-address start limit and may use the
// sign-in emails kept back for known devices (email/budget.ts), so nobody who merely knows the admin address can use
// up the day's sign-in emails before the admin's own request. The cookie names only a hash of the address.
import 'server-only';
import { createHash } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { getEnv } from '@/config/env';
import { signCookie, verifyCookie } from '@/features/invites/tokens';

export const KNOWN_DEVICE_COOKIE = 'twj_admin_device';
/** About six months: a phone Jon signed in on stays known through the season. */
export const KNOWN_DEVICE_TTL_SECONDS = 180 * 86400;
/** Only the sign-in routes read it. */
const KNOWN_DEVICE_PATH = '/api/admin/auth';

/** An address as the limiter and the cookie hold it: a hash, so neither stores an email address. */
export function addressKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/** True when the cookie is ours, unexpired, and was set for this address. */
export function isKnownDevice(cookie: string | undefined, email: string): boolean {
  return verifyCookie('device', cookie, getEnv().SESSION_SIGNING_SECRET) === addressKey(email);
}

/** Marks this browser as the admin's known device (after a successful sign-in only). */
export function setKnownDevice(res: NextResponse, email: string): void {
  res.cookies.set(
    KNOWN_DEVICE_COOKIE,
    signCookie('device', addressKey(email), KNOWN_DEVICE_TTL_SECONDS, getEnv().SESSION_SIGNING_SECRET),
    {
      httpOnly: true,
      secure: getEnv().NEXT_PUBLIC_SITE_URL.startsWith('https'),
      sameSite: 'strict',
      path: KNOWN_DEVICE_PATH,
      maxAge: KNOWN_DEVICE_TTL_SECONDS,
    },
  );
}
