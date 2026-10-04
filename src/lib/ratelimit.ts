// src/lib/ratelimit.ts — AD-9 atomic Postgres limiter. Fails OPEN and alerts Sentry, EXCEPT the auth scopes in
// FAIL_CLOSED, which refuse while the limiter can't count (security review 2026-09-30, C1).
import 'server-only';
import { report } from '@/lib/report';
import { q } from '@/lib/db';
import type { NextRequest } from 'next/server';
import { ERRORS } from '@/content';
import { clientIp, jsonError } from '@/lib/http';

export const LIMITS = {
  requestSend: { limit: 10, windowSec: 3600 },
  photoFinalise: { limit: 20, windowSec: 3600 },
  inviteLookup: { limit: 30, windowSec: 60 },
  // T3.8.02: the capability/token-gated public POSTs. Generous for a real guest (retries, edits), tight for a script.
  storySave: { limit: 30, windowSec: 3600 },
  photoSign: { limit: 30, windowSec: 3600 },
  // New story-page stories per INVITE per day (keyed by invite id, not IP): the general link is shared and forwardable.
  storyPageNew: { limit: 20, windowSec: 86400 },
  // Guest intake emails (E1/E6) per GENERAL invite per day (keyed by invite id): the shared link takes any address.
  // Over it the request is still stored and Jon still gets E2; only the guest's email is skipped.
  requestSendInvite: { limit: 20, windowSec: 86400 },
  offerTake: { limit: 10, windowSec: 3600 }, // T2.4 guest takes/proposes an offered time
  manageAction: { limit: 20, windowSec: 3600 }, // T2.7 /api/manage/* (cancel, ask another time, add a story)
  eventBeacon: { limit: 60, windowSec: 3600 }, // T3.11: POST /api/events (sheet/picker opened)
  devLogin: { limit: 10, windowSec: 3600 }, // T1.10.10: slows passphrase guessing on /dev/login
  adminSignInStart: { limit: 5, windowSec: 3600 }, // T2.1.08: every address alike; over it, the same 200
  adminSignInVerify: { limit: 10, windowSec: 3600 }, // T2.1.04: codes + link opens per IP (the callback shares it)
  adminSignInVerifyEmail: { limit: 10, windowSec: 3600 }, // per address, WRONG codes only (a right one always passes)
} as const;

export type LimitScope = keyof typeof LIMITS;

/**
 * Security review 2026-09-30 (C1): sign-in and guessing surfaces must FAIL CLOSED. If the limiter can't count
 * (DB down, pooler fault, a read-only backend), these scopes refuse the call instead of letting unthrottled
 * code/link guesses through. Everything else keeps failing open so a DB blip never blocks a guest.
 */
export const FAIL_CLOSED: ReadonlySet<LimitScope> = new Set<LimitScope>([
  'adminSignInStart',
  'adminSignInVerify',
  'adminSignInVerifyEmail',
  'devLogin',
]);

/** 'allowed' | 'limited' (over the window) | 'unavailable' (limiter error on a FAIL_CLOSED scope). */
export type LimitVerdict = 'allowed' | 'limited' | 'unavailable';

/** Counts one hit and says what to do. A limiter error is reported, then fails open or closed by scope. */
export async function check(scope: LimitScope, key: string): Promise<LimitVerdict> {
  const { limit, windowSec } = LIMITS[scope];
  try {
    const rows = await q<{ count: number }>(
      `insert into rate_limit (scope, key, window_start, count)
       values ($1, $2, date_bin(make_interval(secs => $3), now(), timestamptz 'epoch'), 1)
       on conflict (scope, key, window_start) do update set count = rate_limit.count + 1
       returning count`,
      [scope, key, windowSec],
    );
    return (rows[0]?.count ?? 0) <= limit ? 'allowed' : 'limited';
  } catch (e) {
    const closed = FAIL_CLOSED.has(scope);
    report(e, { area: 'ratelimit', scope, ...(closed ? { mode: 'fail_closed' } : {}) });
    return closed ? 'unavailable' : 'allowed';
  }
}

/** Returns true when the call is ALLOWED. A FAIL_CLOSED scope returns false while the limiter is down. */
export async function hit(scope: LimitScope, key: string): Promise<boolean> {
  return (await check(scope, key)) === 'allowed';
}

/**
 * T3.8.02: the per-IP guard for a public POST. Returns the friendly 429 when over the limit, else null.
 * Call it right after the Origin check, before any cookie, token or body work, so every attempt counts.
 */
export async function limitByIp(req: NextRequest, scope: keyof typeof LIMITS): Promise<Response | null> {
  return (await hit(scope, clientIp(req))) ? null : jsonError(429, 'rate_limited', ERRORS.rateLimited);
}

/**
 * T3.8.02 for limits that count SUCCESSES only (photoFinalise): a read-only check up front, then the route
 * calls hit() after the work succeeded, so failed retries never use up the guest's allowance. Fails open.
 */
export async function overLimitByIp(req: NextRequest, scope: keyof typeof LIMITS): Promise<Response | null> {
  const { limit, windowSec } = LIMITS[scope];
  try {
    const rows = await q<{ count: number }>(
      `select count from rate_limit
        where scope = $1 and key = $2 and window_start = date_bin(make_interval(secs => $3), now(), timestamptz 'epoch')`,
      [scope, clientIp(req), windowSec],
    );
    return (rows[0]?.count ?? 0) >= limit ? jsonError(429, 'rate_limited', ERRORS.rateLimited) : null;
  } catch (e) {
    report(e, { area: 'ratelimit', scope });
    return null;
  }
}
