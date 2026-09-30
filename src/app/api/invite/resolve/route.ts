// src/app/api/invite/resolve/route.ts — T1.4: resolve ?for=, set twj_invite, 303 to the clean URL.
// Reached only through the rewrite in src/proxy.ts. GET is safe here: it sets a session, it never acts.
import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@/config/env';
import { clientIp, safeRedirectTarget } from '@/lib/http';
import { findInviteById, findInviteBySecret, recordOpen } from '@/features/invites/repo';
import { INVITE_COOKIE, INVITE_TTL_SECONDS, STALE_COOKIE } from '@/features/invites/session';
import { hit } from '@/lib/ratelimit';
import { isPreviewBot } from '@/features/invites/bots';
import { countEvent } from '@/features/analytics/count';
import { parseForParam, signCookie, verifyCookie } from '@/features/invites/tokens';
import { ERRORS } from '@/content';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cleanTarget(req: NextRequest): URL {
  const url = safeRedirectTarget(req.nextUrl.searchParams.get('next'), getEnv().NEXT_PUBLIC_SITE_URL);
  url.searchParams.delete('for');
  return url;
}

/** L2: a mistyped, old or hostile link must not log out a guest who already has a valid session. */
async function hasValidSession(req: NextRequest): Promise<boolean> {
  const id = verifyCookie('invite', req.cookies.get(INVITE_COOKIE)?.value, getEnv().SESSION_SIGNING_SECRET);
  if (!id) return false;
  const current = await findInviteById(id);
  return Boolean(current && !current.revoked_at);
}

export async function GET(req: NextRequest) {
  const target = cleanTarget(req);
  if (!(await hit('inviteLookup', clientIp(req)))) {
    return NextResponse.json(
      { ok: false, code: 'rate_limited', message: ERRORS.rateLimited },
      { status: 429 },
    );
  }
  const parsed = parseForParam(req.nextUrl.searchParams.get('for'));
  const invite = parsed ? await findInviteBySecret(parsed.secret) : null;
  const res = NextResponse.redirect(target, 303);
  const secure = getEnv().NEXT_PUBLIC_SITE_URL.startsWith('https');
  if (!invite || invite.revoked_at) {
    if (await hasValidSession(req)) return res;
    res.cookies.delete(INVITE_COOKIE);
    res.cookies.set(STALE_COOKIE, '1', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 86400 });
    return res;
  }
  if (!isPreviewBot(req.headers.get('user-agent'), req.method)) {
    await recordOpen(invite.id);
    await countEvent('invite_opened'); // T3.11
  }
  res.cookies.set(
    INVITE_COOKIE,
    signCookie('invite', invite.id, INVITE_TTL_SECONDS, getEnv().SESSION_SIGNING_SECRET),
    {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: INVITE_TTL_SECONDS,
    },
  );
  res.cookies.delete(STALE_COOKIE);
  return res;
}
export const HEAD = GET;
