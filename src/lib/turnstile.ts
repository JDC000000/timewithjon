// src/lib/turnstile.ts — AD-9 server verify. Fails OPEN (with a Sentry alert) only if siteverify is unreachable.
// Outside prototype the solve must also come from our own site (siteverify's hostname = NEXT_PUBLIC_SITE_URL's host);
// prototype skips that check (PR previews run on other hosts, and Cloudflare's test keys answer example.com).
import 'server-only';
import { report, reportMessage } from '@/lib/report';
import { getEnv } from '@/config/env';

export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const env = getEnv();
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    reportMessage('TURNSTILE_SECRET_KEY missing: failing open', { area: 'turnstile' });
    return true;
  }
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    const out = (await res.json()) as { success?: boolean; hostname?: string };
    if (out.success !== true) return false;
    // Production only: staging and previews may run Cloudflare's test keys, whose answers name another host.
    if (env.APP_MODE !== 'production') return true;
    const ours = new URL(env.NEXT_PUBLIC_SITE_URL).hostname;
    if (out.hostname === ours) return true;
    reportMessage('turnstile hostname mismatch', { area: 'turnstile', step: 'hostname' }); // a config slip shows
    return false;
  } catch (e) {
    report(e, { area: 'turnstile' });
    return true;
  }
}
