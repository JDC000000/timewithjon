// src/lib/turnstile.ts — AD-9 server verify. Fails OPEN (with a Sentry alert) only if siteverify is unreachable.
// Outside prototype the solve must also come from our own site (siteverify's hostname = NEXT_PUBLIC_SITE_URL's host)
// and from the widget of the form that sent it (its `action`, src/lib/turnstile-actions.ts); prototype skips both
// (PR previews run on other hosts, and Cloudflare's test keys answer example.com). Staging runs its own widget.
import 'server-only';
import { report, reportMessage } from '@/lib/report';
import { getEnv } from '@/config/env';
import type { TurnstileAction } from './turnstile-actions';

export async function verifyTurnstile(
  token: string | undefined,
  ip: string,
  action: TurnstileAction,
): Promise<boolean> {
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
    const out = (await res.json()) as { success?: boolean; hostname?: string; action?: string };
    if (out.success !== true) return false;
    // Prototype runs Cloudflare's test keys (another host, no real action): only `success` counts there.
    if (env.APP_MODE === 'prototype') return true;
    if (out.hostname !== new URL(env.NEXT_PUBLIC_SITE_URL).hostname) {
      reportMessage('turnstile hostname mismatch', { area: 'turnstile', step: 'hostname' }); // a config slip shows
      return false;
    }
    if (out.action !== action) {
      reportMessage('turnstile action mismatch', { area: 'turnstile', step: 'action' });
      return false;
    }
    return true;
  } catch (e) {
    report(e, { area: 'turnstile' });
    return true;
  }
}
