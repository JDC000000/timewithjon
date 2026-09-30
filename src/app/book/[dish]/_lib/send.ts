// The guest Send (T1.7.U4): one POST /api/requests per Send, shared by all three flows. Pure (no React): the flow
// builds the picks, the hook adds the details, this module shapes the body and reads the answer. The invite rides
// on its cookie (C2), never in the body. A saved request answers { ok: true } and sets the twj_req capability that
// /sent reads; anything else answers { ok: false, code, message } and the message is shown as it came.
import { ERRORS } from '@/content';
import type { RequestBody } from '@/features/requests/schema';

/** What a flow picked: times (or a stand-by week), dates, a rough window, the idea, Surprise Me's plan. */
export type Picks = Partial<
  Omit<
    RequestBody,
    'clientKey' | 'dish' | 'name' | 'email' | 'phone' | 'crew' | 'note' | 'hp' | 'turnstileToken'
  >
>;

export interface Details {
  name: string;
  email: string;
  /** the honeypot (AD-9): a filled one is stored as spam, never refused */
  hp: string;
}

export type RequestPayload = Picks & {
  clientKey: string;
  dish: string;
  name: string;
  email: string;
  crew: number;
  hp?: string;
  turnstileToken?: string;
};

export type SendResult = { ok: true } | { ok: false; code: string; message: string };

/** Empty optional text is left out, so the server sees "not given" rather than "". */
const text = (s: string | null | undefined) => (s && s.trim() ? s.trim() : undefined);

export function requestPayload(
  clientKey: string,
  dish: string,
  details: Details,
  picks: Picks,
  turnstileToken?: string,
): RequestPayload {
  const body: RequestPayload = {
    ...picks,
    clientKey,
    dish,
    name: details.name.trim(),
    email: details.email.trim(),
    crew: 1, // FLOW.crewDefault: "Just me." (no crew field on these screens yet)
    hp: text(details.hp),
    turnstileToken,
  };
  // Every free-text pick (the window, the night, the idea, Surprise Me's notes) is trimmed; blank ones drop out.
  const fields = body as Record<string, unknown>;
  for (const [k, v] of Object.entries(picks)) if (typeof v === 'string') fields[k] = text(v);
  if (!body.standbyWeek) delete body.standbyWeek;
  return JSON.parse(JSON.stringify(body)) as RequestPayload; // drops the undefined keys
}

/**
 * One sender per form: a second Send while one is in flight (or after one landed) is refused with null, so a double
 * tap never posts twice. A failed send frees it for the next try.
 */
export function createSender(fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  let busy = false;
  let sent = false;
  return async function send(body: RequestPayload): Promise<SendResult | null> {
    if (busy || sent) return null;
    busy = true;
    try {
      const res = await fetchImpl('/api/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        code?: string;
        message?: string;
      } | null;
      if (res.ok && json?.ok) {
        sent = true;
        return { ok: true };
      }
      return { ok: false, code: json?.code ?? 'http', message: json?.message ?? ERRORS.generic };
    } catch {
      return { ok: false, code: 'network', message: ERRORS.generic };
    } finally {
      busy = false;
    }
  };
}
