// src/features/admin/verify.ts — T2.1.04: finish an admin sign-in, by the 6-digit code or by the emailed link.
// AD-7 (orchestrator decision 2026-09-25): the link carries a token_hash, checked with verifyOtp, so it needs no
// PKCE verifier cookie and also works in Gmail's in-app browser. Supabase consumes the token: one use only.
import 'server-only';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { report } from '@/lib/report';
import { isAdminEmail } from './auth';
import { clearSignInFailure } from './signin';
import { adminAuthClient } from './supabase';

export type SignInProof = { email: string; code: string } | { tokenHash: string };

export type SignInResult = { ok: true; email: string } | { ok: false; reason: 'invalid' | 'not_admin' };

/**
 * Sets the session cookies (through the cookie-backed client) on success. A failed proof is only ever
 * 'invalid' (never why); 'not_admin' means Supabase verified a user who is no longer on the allowlist.
 */
export async function completeSignIn(proof: SignInProof): Promise<SignInResult> {
  const client = await adminAuthClient();
  const { data, error } =
    'tokenHash' in proof
      ? await client.auth.verifyOtp({ token_hash: proof.tokenHash, type: 'email' })
      : await client.auth.verifyOtp({ email: proof.email, token: proof.code, type: 'email' });
  // Review L2: an Auth outage or Supabase's own limit would otherwise look like a typo. The limiters bound it.
  if (error && (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500 || error.status === 429)) {
    report(error, { area: 'admin_verify' });
  }
  const email = data.user?.email?.toLowerCase();
  if (error || !email || !data.session) return { ok: false, reason: 'invalid' };
  if (!isAdminEmail(email)) {
    // A user who is no longer on the allowlist: drop the session that verifyOtp just set.
    await client.auth.signOut({ scope: 'local' });
    return { ok: false, reason: 'not_admin' };
  }
  await clearSignInFailure(); // T2.1.09: the sign-in email evidently arrived
  return { ok: true, email };
}
