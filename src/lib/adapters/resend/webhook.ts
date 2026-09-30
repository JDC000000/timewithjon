// src/lib/adapters/resend/webhook.ts — T3.13.01 (a): Resend signs webhooks with Svix. Verified here with
// node:crypto (no extra dependency): HMAC-SHA256 over "{svix-id}.{svix-timestamp}.{raw body}", keyed with the
// base64 part of the "whsec_…" secret; the svix-signature header lists "v1,<base64>" entries (any may match).
// The timestamp must be within 5 minutes (replay window); the route dedupes on svix-id inside that window.
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOLERANCE_S = 5 * 60;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function svixSign(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

export function verifySvix(secret: string, h: SvixHeaders, body: string, nowMs = Date.now()): boolean {
  if (!h.id || !h.timestamp || !h.signature || !/^\d{1,12}$/.test(h.timestamp)) return false;
  // pr34 L2: webhook_event.id is ≤ 200 chars; a longer or odd id would 500 and loop Svix's retries.
  if (h.id.length > 200 || !/^[\w-]+$/.test(h.id)) return false;
  if (Math.abs(nowMs / 1000 - Number(h.timestamp)) > TOLERANCE_S) return false;
  const expected = Buffer.from(svixSign(secret, h.id, h.timestamp, body));
  return h.signature.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
