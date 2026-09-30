// src/app/admin/sign-in/sign-in-logic.ts — T2.1.U1: the A1 sign-in steps without React (validation, the two
// POSTs and how each answer reads), so the rules are unit-tested. The server answers are fixed by T2.1.03/.04:
// start = 200 for any address (it never tells who the admin is) or 400 bot_check; verify = 200, 400, 401 or 429.
import { ERRORS } from '@/content';
import { SIGN_IN } from '@/content/ui/admin-requests';
import { send, type Send } from '../_requests/api';

/** One field error: `field` is the line under the field, `summary` the line in "Things to fix". */
export interface FieldError {
  field: string;
  summary: string;
}

/** The pack's check (site.js): something@something.tld. The server's Zod check is the real one. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export function emailError(raw: string): FieldError | null {
  const v = raw.trim();
  if (!v) return { field: SIGN_IN.emailEmpty, summary: SIGN_IN.emailEmpty };
  if (v.length > 254 || !EMAIL_SHAPE.test(v)) {
    return { field: ERRORS.badEmail, summary: SIGN_IN.emailBadSummary };
  }
  return null;
}

/** A pasted code may carry spaces ("482 119") or a line break; only the digits count. */
export function normaliseCode(raw: string): string {
  return raw.replace(/\s+/g, '');
}

export function codeError(raw: string): FieldError | null {
  return /^\d{6}$/.test(normaliseCode(raw)) ? null : { field: SIGN_IN.codeWrong, summary: SIGN_IN.codeWrong };
}

export type StartOutcome = { ok: true } | { ok: false; message: string };

/** Step 1: ask for a code. The answer is the same for every address, so ok only means "sent if allowed". */
export async function requestCode(
  email: string,
  turnstileToken: string | undefined,
  post: Send = send,
): Promise<StartOutcome> {
  const res = await post('POST', '/api/admin/auth/start', { email: email.trim(), turnstileToken });
  if (res.status === 200) return { ok: true };
  if (res.status === 400 && res.code === 'bot_check') return { ok: false, message: ERRORS.botCheck };
  if (res.status === 429) return { ok: false, message: ERRORS.rateLimited };
  return { ok: false, message: ERRORS.generic };
}

/** Where a failed code lands: under the field (a wrong code) or as a notice (everything else). */
export type VerifyOutcome =
  | { ok: true }
  | { ok: false; where: 'field'; error: FieldError }
  | { ok: false; where: 'notice'; message: string };

/** Step 2: the 6-digit code signs in within this tab (T2.1.04). */
export async function verifyCode(email: string, code: string, post: Send = send): Promise<VerifyOutcome> {
  const res = await post('POST', '/api/admin/auth/verify', {
    email: email.trim(),
    code: normaliseCode(code),
  });
  if (res.status === 200) return { ok: true };
  if (res.status === 429) return { ok: false, where: 'notice', message: SIGN_IN.tooManyTries };
  // 400 invalid_code and 401 (a verified address off the allowlist) read the same: never say who the admin is.
  if (res.status === 400 || res.status === 401) {
    return { ok: false, where: 'field', error: { field: SIGN_IN.codeWrong, summary: SIGN_IN.codeWrong } };
  }
  return { ok: false, where: 'notice', message: ERRORS.generic };
}

/** The email survives a reload of the code step in this tab only (sessionStorage: never the URL, never logs). */
export const EMAIL_KEY = 'twj_admin_signin_email';
