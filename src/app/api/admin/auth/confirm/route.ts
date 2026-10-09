// src/app/api/admin/auth/confirm/route.ts — T2.1.U1 (V5): the A1c "Sign me in" POST, the ONLY place the emailed
// link's token_hash is spent. Keeps every T2.1.04 guarantee of the old GET callback: exactly one well-formed token
// hash, verifyOtp type 'email' only (Supabase consumes it: one use; a replay fails cleanly), the allowlist re-check
// (401 for a verified user who isn't the admin), a fixed /admin redirect (no open redirect), no-store, and nothing
// token-related in logs or Sentry. New: same-origin only, plus the interstitial's CSRF token for this exact link
// (login-CSRF and link scanners can't sign anyone in), and the same per-IP limit as the code route.
// Security-relevant: see the PR body.
import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@/config/env';
import { ERRORS } from '@/content';
import { adminFeatureOff } from '@/features/admin/auth';
import { setKnownDevice } from '@/features/admin/known-device';
import { completeSignIn } from '@/features/admin/verify';
import { clientIp, jsonError, noStore, readBytesAtMost, sameOrigin } from '@/lib/http';
import { check } from '@/lib/ratelimit';
import {
  ADMIN_HOME,
  SIGN_IN_FAILED,
  SIGN_IN_UNAVAILABLE,
  TOKEN_HASH,
  verifyConfirm,
} from '@/app/admin/auth/confirm-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One value of a form field, or null when it's missing, repeated or not text. */
function one(form: FormData, name: string): string | null {
  const all = form.getAll(name);
  return all.length === 1 && typeof all[0] === 'string' ? all[0] : null;
}

/** The confirm form (two short fields), read through the bounded reader, then parsed as the browser sent it. */
const MAX_FORM_BYTES = 4 * 1024;
async function boundedForm(req: NextRequest): Promise<FormData | null> {
  const bytes = await readBytesAtMost(req, MAX_FORM_BYTES);
  if (bytes === null) return null;
  const type = req.headers.get('content-type') ?? '';
  return new Request('http://form.invalid', {
    method: 'POST',
    headers: { 'content-type': type },
    body: new Uint8Array(bytes),
  })
    .formData()
    .catch(() => null);
}

function see(path: string): NextResponse {
  // 303: the browser follows with a GET, so a refresh never re-posts the spent token.
  return noStore(NextResponse.redirect(new URL(path, getEnv().NEXT_PUBLIC_SITE_URL), 303));
}

export async function POST(req: NextRequest) {
  const off = adminFeatureOff();
  if (off) return off;
  if (!sameOrigin(req)) return noStore(jsonError(403, 'bad_origin', ERRORS.generic));

  const form = await boundedForm(req);
  const tokenHash = form && one(form, 'token_hash');
  const csrf = form && one(form, 'csrf');
  if (!tokenHash || !csrf || !TOKEN_HASH.test(tokenHash)) {
    return noStore(jsonError(400, 'invalid', ERRORS.generic));
  }
  if (!verifyConfirm(tokenHash, csrf)) return noStore(jsonError(403, 'bad_csrf', ERRORS.generic));
  // Review F2 (T2.1.04): link confirms share the code route's per-IP bucket.
  const verdict = await check('adminSignInVerify', clientIp(req));
  // Fail closed (security review 2026-09-30): the token is NOT spent while the limiter is down.
  if (verdict === 'unavailable') return see(SIGN_IN_UNAVAILABLE);
  if (verdict === 'limited') return see(SIGN_IN_FAILED);

  const result = await completeSignIn({ tokenHash });
  if (!result.ok && result.reason === 'not_admin') {
    return noStore(jsonError(401, 'unauthorized', ERRORS.generic));
  }
  if (!result.ok) return see(SIGN_IN_FAILED);
  const res = see(ADMIN_HOME);
  setKnownDevice(res, result.email); // the link signed in: this browser is now the admin's known device
  return res;
}
