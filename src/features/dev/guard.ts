// src/lib/dev/guard.ts — /dev/* access (AD-13). Files using it are *.dev.ts(x) only, so prototype builds only.
// Access = the x-dev-pass header (scripts, curl) OR a valid twj_dev cookie set by POST /dev/login (browsers).
// Never a query string: ?pass= ends up in logs and history (review L4, T1.10.10).
import 'server-only';
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@/config/env';
import { loadSettings } from '@/lib/settings';
import { safeEqual, signCookie, verifyCookie } from '@/features/invites/tokens';

export const DEV_COOKIE = 'twj_dev';
export const DEV_TTL_SECONDS = 8 * 3600;

/** Prototype build + a passphrase configured. Everything under /dev is a 404 otherwise. */
export function devEnabled(): boolean {
  return getEnv().APP_MODE === 'prototype' && Boolean(getEnv().DEV_PASSPHRASE);
}
export function passphraseOk(pass: string | null | undefined): boolean {
  return devEnabled() && Boolean(pass) && safeEqual(pass!, getEnv().DEV_PASSPHRASE!);
}
/** T4.2.01a L1: the cookie value is derived from the passphrase, so rotating DEV_PASSPHRASE revokes every live
 * twj_dev cookie (without touching SESSION_SIGNING_SECRET, which would log every guest out). */
export function passphraseTag(passphrase = getEnv().DEV_PASSPHRASE ?? ''): string {
  return createHash('sha256').update(`twj-dev:${passphrase}`).digest('base64url').slice(0, 16);
}
export function devCookieValue(): string {
  return signCookie('dev', passphraseTag(), DEV_TTL_SECONDS, getEnv().SESSION_SIGNING_SECRET);
}
export function devCookieOk(cookie: string | undefined): boolean {
  return devEnabled() && verifyCookie('dev', cookie, getEnv().SESSION_SIGNING_SECRET) === passphraseTag();
}
/** The DB must say prototype too (a proto build pointed at another database refuses). */
export async function settingsArePrototype(): Promise<boolean> {
  return (await loadSettings()).env === 'prototype';
}

export async function devGuard(req: NextRequest): Promise<NextResponse | null> {
  const ok = passphraseOk(req.headers.get('x-dev-pass')) || devCookieOk(req.cookies.get(DEV_COOKIE)?.value);
  if (!ok) return new NextResponse('Not found', { status: 404 });
  if (!(await settingsArePrototype()))
    return new NextResponse('Refused: settings.env is not prototype', { status: 409 });
  return null;
}
