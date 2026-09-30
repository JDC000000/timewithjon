// src/features/admin/supabase.ts — the only place that talks to Supabase Auth (AD-7). Tests mock this module.
import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, isAuthRetryableFetchError, type AuthError } from '@supabase/supabase-js';
import { getEnv } from '@/config/env';
import { report } from '@/lib/report';

/** AD-7 / T2.1.04: SameSite=Lax (the emailed link is a top-level GET) and Secure. Server-only, so httpOnly. */
export const ADMIN_COOKIE_OPTIONS = { sameSite: 'lax', secure: true, httpOnly: true, path: '/' } as const;

/** A cookie-backed client for the current request (session read, refresh, verify, sign-out). */
export async function adminAuthClient() {
  const store = await cookies();
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = getEnv();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: ADMIN_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components can't set cookies; the next Route Handler call writes the refreshed session.
        }
      },
    },
  });
}

/** The signed-in user's email, checked with the Auth server (getUser, never the unverified cookie), or null. */
export async function currentAuthEmail(): Promise<string | null> {
  const { data, error } = await (await adminAuthClient()).auth.getUser();
  if (error) {
    // Review L13: a forged, expired or missing cookie (4xx) is the caller's problem, not ours; reporting it
    // would let anyone drain the Sentry quota. Only Auth being unreachable or failing (5xx) is reported.
    if (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500) report(error, { area: 'admin_auth' });
    return null;
  }
  return data.user?.email?.toLowerCase() ?? null;
}

/**
 * Asks Supabase to send the link-and-code email. Stateless on purpose: the start route runs this inside
 * `after()`, when the response (and its cookies) is already gone, so no PKCE verifier could be kept anyway.
 */
export async function sendOtpEmail(email: string): Promise<{ error: AuthError | null }> {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, NEXT_PUBLIC_SITE_URL } = getEnv();
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    // Review I3: 'implicit' is right only while the template links with {{ .TokenHash }} (supabase/templates/
    // admin-sign-in.html). A {{ .ConfirmationURL }} link would put the tokens in a fragment the server can't read.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit' },
  });
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${NEXT_PUBLIC_SITE_URL}/admin/auth/callback` },
  });
  return { error };
}
