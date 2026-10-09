// src/features/admin/signin.ts — T2.1.03/07/09: the work behind POST /api/admin/auth/start, run in after().
// Class P0 (AD-5, AD-7): counted, capped, never queued by the app.
import 'server-only';
import { isAuthRetryableFetchError, type AuthError } from '@supabase/supabase-js';
import { getEnv, type AppMode } from '@/config/env';
import { releaseSlot, takeSlot } from '@/features/email/budget';
import { q } from '@/lib/db';
import { check } from '@/lib/ratelimit';
import { reportMessage } from '@/lib/report';
import { isAdminEmail } from './auth';
import { addressKey } from './known-device';
import { sendOtpEmail } from './supabase';

export const SIGNIN_FAILED_KEY = 'signin_email_failed_at';
/** AD-7 F3: at this many sends today (before the call) the sign-in still goes out, but the flag is raised. */
const QUOTA_WARN_AT = 100;

export type SignInFailure = 'smtp' | 'quota' | 'capped';
export type SignInOutcome = 'not_allowlisted' | 'limited' | 'capped' | 'sent' | 'refused' | 'unknown';

/** T2.1.09: /api/health (T3.14) reads this row; a successful verify or callback (T2.1.04) clears it. */
export async function flagSignInFailure(reason: SignInFailure): Promise<void> {
  await q(
    `insert into system_status (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [SIGNIN_FAILED_KEY, reason],
  );
  reportMessage('admin sign-in email problem', { area: 'admin_signin', reason });
}

export async function clearSignInFailure(): Promise<void> {
  await q('delete from system_status where key = $1', [SIGNIN_FAILED_KEY]);
}

/** Supabase's own 60-second wait and its 5-an-hour email limit: expected, refunded, not a failure. */
function isSupabaseThrottle(error: AuthError): boolean {
  return error.status === 429;
}

/**
 * @param knownDevice the start came from the browser the admin last signed in on (a valid known-device cookie): it
 *   skips the per-address limit and may use the sign-in emails kept back for it, so a stranger who knows the
 *   address can't use up the day's sign-in emails before the admin's own request. Any other browser counts against
 *   LIMITS.adminSignInStartEmail and stops short of the kept slots.
 */
export async function sendAdminSignIn(
  email: string,
  mode: AppMode = getEnv().APP_MODE,
  knownDevice = false,
): Promise<SignInOutcome> {
  if (!isAdminEmail(email)) return 'not_allowlisted';
  if (!knownDevice) {
    // Fail closed: no limiter, no email (the known device never depends on it).
    const verdict = await check('adminSignInStartEmail', addressKey(email));
    if (verdict !== 'allowed') {
      console.warn(JSON.stringify({ level: 'warn', event: 'signin_address_limited', mode }));
      return 'limited';
    }
  }

  const slot = await takeSlot('signin', mode, knownDevice);
  if (!slot) {
    console.warn(JSON.stringify({ level: 'warn', event: 'signin_capped', mode }));
    await flagSignInFailure('capped');
    return 'capped';
  }
  if (slot.count - 1 >= QUOTA_WARN_AT) await flagSignInFailure('quota');

  const { error } = await sendOtpEmail(email);
  if (!error) return 'sent';
  if (isAuthRetryableFetchError(error)) {
    // A network failure or timeout: the email may have gone out, so the slot stays (the cap bounds it).
    await flagSignInFailure('smtp');
    return 'unknown';
  }
  await releaseSlot('signin', slot.day);
  if (!isSupabaseThrottle(error)) await flagSignInFailure('smtp');
  return 'refused';
}
