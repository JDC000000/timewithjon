// src/lib/ratelimit.ts — AD-9 atomic Postgres limiter. Fails OPEN and alerts Sentry.
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
  offerTake: { limit: 10, windowSec: 3600 }, // T2.4 guest takes/proposes an offered time
  manageAction: { limit: 20, windowSec: 3600 }, // T2.7 /api/manage/* (cancel, ask another time, add a story)
  eventBeacon: { limit: 60, windowSec: 3600 }, // T3.11: POST /api/events (sheet/picker opened)
  devLogin: { limit: 10, windowSec: 3600 }, // T1.10.10: slows passphrase guessing on /dev/login
  adminSignInStart: { limit: 5, windowSec: 3600 }, // T2.1.08: every address alike; over it, the same 200
  adminSignInVerify: { limit: 10, windowSec: 3600 }, // T2.1.04: codes + link opens per IP (the callback shares it)
  adminSignInVerifyEmail: { limit: 10, windowSec: 3600 }, // review F1: per address, so no IP pool out-guesses a code
} as const;

/** Returns true when the call is ALLOWED. */
export async function hit(scope: keyof typeof LIMITS, key: string): Promise<boolean> {
  const { limit, windowSec } = LIMITS[scope];
  try {
    const rows = await q<{ count: number }>(
      `insert into rate_limit (scope, key, window_start, count)
       values ($1, $2, date_bin(make_interval(secs => $3), now(), timestamptz 'epoch'), 1)
       on conflict (scope, key, window_start) do update set count = rate_limit.count + 1
       returning count`,
      [scope, key, windowSec],
    );
    return (rows[0]?.count ?? 0) <= limit;
  } catch (e) {
    report(e, { area: 'ratelimit', scope });
    return true;
  }
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
