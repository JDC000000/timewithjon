// src/lib/turnstile.ts — AD-9 server verify. Fails OPEN (with a Sentry alert) only if siteverify is unreachable.
import 'server-only';
import { report, reportMessage } from '@/lib/report';
import { getEnv } from '@/config/env';

export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = getEnv().TURNSTILE_SECRET_KEY;
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
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch (e) {
    report(e, { area: 'turnstile' });
    return true;
  }
}
