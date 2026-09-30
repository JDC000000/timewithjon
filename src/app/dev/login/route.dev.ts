// src/app/dev/login/route.dev.ts — T1.10.10: the /dev passphrase travels only in a POSTed form body, and becomes
// an HttpOnly, SameSite=Strict, Path=/dev cookie for 8 h. Internal tool, deliberately unstyled. Prototype only.
import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@/config/env';
import { DEV_COOKIE, DEV_TTL_SECONDS, devCookieValue, devEnabled, passphraseOk } from '@/features/dev/guard';
import { clientIp } from '@/lib/http';
import { hit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const notFound = () => new NextResponse('Not found', { status: 404 });

export function GET() {
  if (!devEnabled()) return notFound();
  const html =
    '<!doctype html><title>/dev login</title><form method="post" action="/dev/login">' +
    '<label>Passphrase <input type="password" name="pass" autocomplete="current-password" required></label> ' +
    '<button>Enter</button></form>';
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function POST(req: NextRequest) {
  if (!devEnabled()) return notFound();
  if (!(await hit('devLogin', clientIp(req)))) return new NextResponse('Too many tries', { status: 429 });
  const form = await req.formData().catch(() => null);
  const pass = form?.get('pass');
  if (typeof pass !== 'string' || !passphraseOk(pass)) return notFound();
  const res = NextResponse.redirect(new URL('/dev/outbox', getEnv().NEXT_PUBLIC_SITE_URL), 303);
  res.cookies.set(DEV_COOKIE, devCookieValue(), {
    httpOnly: true,
    secure: getEnv().NEXT_PUBLIC_SITE_URL.startsWith('https'),
    sameSite: 'strict',
    path: '/dev',
    maxAge: DEV_TTL_SECONDS,
  });
  return res;
}
