// src/lib/adapters/resend/status.ts — T3.13.01 (b): polling mode. GET /emails/{id} → Resend's last event.
// Needs a key that may read emails (a sending-only key gets 401/403: MailerHttpError, the job stops).
import 'server-only';
import type { DeliveryEvent } from '@/features/email/outcome';
import { MailerHttpError } from '../errors';

export const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
/** Resend allows 10 requests/s per team (docs, checked 2026-09-25): polling uses at most 4/s, sends keep the rest. */
export const RESEND_POLL_SPACING_MS = 250;

export function mapLastEvent(lastEvent: unknown): DeliveryEvent {
  if (lastEvent === 'bounced') return 'bounced';
  if (lastEvent === 'complained') return 'complained';
  if (lastEvent === 'delivered' || lastEvent === 'opened' || lastEvent === 'clicked') return 'delivered';
  return 'pending'; // sent, queued, delivery_delayed, …: ask again next tick
}

export interface DeliveryStatusSource {
  /** `to` lets the mock answer by address; the real source only uses the provider id. */
  status(providerId: string, to: string, timeoutMs?: number): Promise<DeliveryEvent>;
  /** Pause between calls (pr34 M3): the real API shares its rate limit with live sends; the mock needs none. */
  readonly spacingMs?: number;
}

export function createResendStatusSource(
  apiKey: string,
  doFetch: typeof fetch = fetch,
): DeliveryStatusSource {
  return {
    spacingMs: RESEND_POLL_SPACING_MS,
    async status(providerId, _to, timeoutMs = 3000) {
      // pr34 M2: never hang the tick (a TimeoutError ends the poll for this tick).
      const res = await doFetch(`${RESEND_EMAILS_URL}/${encodeURIComponent(providerId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) return 'pending'; // not visible yet; the row ages out after 72 h
      if (!res.ok) throw new MailerHttpError(res.status);
      const body = (await res.json()) as { last_event?: unknown };
      return mapLastEvent(body.last_event);
    },
  };
}
