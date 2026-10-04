// src/lib/adapters/resend/mailer.ts — T3.2.01: the Resend REST sender (AD-5). The idempotency key is
// email_log.id. 3 quick retries on a 5xx, a network error or timeout, the 429 rate limit, or a 409 (an earlier try
// with this key is still in flight; the replay returns the original id); a 429 quota error is never retried
// (AD-5 rule 6): it throws MailerQuotaError and the send path queues the email for the next UTC day.
import 'server-only';
import { MailerHttpError, MailerQuotaError } from '../errors';
import { MailDeadlineError, mailCallTimeoutMs } from '../mail-deadline';
import type { Mailer, OutgoingEmail } from '../types';

export const RESEND_URL = 'https://api.resend.com/emails';
/** Waits before retries 1, 2 and 3. Short: the request that sent it is waiting (the tick retries later). */
export const RETRY_DELAYS_MS = [250, 750, 1500] as const;
/** Per attempt: a hung socket must not hold the request (and its claimed email_log row). pr31 review L2. */
export const ATTEMPT_TIMEOUT_MS = 10_000;
const QUOTA_ERRORS = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded']);

export interface ResendOptions {
  apiKey: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function resendBody(e: OutgoingEmail) {
  return {
    from: e.from,
    to: [e.to],
    reply_to: e.replyTo,
    subject: e.subject,
    text: e.text,
    ...(e.html ? { html: e.html } : {}),
    ...(e.headers ? { headers: e.headers } : {}),
    ...(e.attachments?.length
      ? {
          attachments: e.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            content_type: a.contentType,
          })),
        }
      : {}),
  };
}

async function errorNameOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { name?: unknown };
    return typeof body.name === 'string' ? body.name : '';
  } catch {
    return '';
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createResendMailer(opts: ResendOptions): Mailer {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? wait;
  return {
    async send(e) {
      const init = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': e.idempotencyKey,
        },
        body: JSON.stringify(resendBody(e)),
      } satisfies RequestInit;
      for (let attempt = 0; ; attempt++) {
        let retryable: Error;
        // T3.9.01: never past the caller's hard stop (the tick's), retry waits included.
        const timeoutMs = mailCallTimeoutMs(ATTEMPT_TIMEOUT_MS);
        if (timeoutMs <= 0) throw new MailDeadlineError('resend send not started: past the hard stop');
        try {
          const res = await doFetch(RESEND_URL, {
            ...init,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res.ok) {
            const { id } = (await res.json()) as { id: string };
            return { id };
          }
          if (res.status === 429 && QUOTA_ERRORS.has(await errorNameOf(res))) {
            throw new MailerQuotaError('resend quota');
          }
          if (res.status !== 429 && res.status !== 409 && res.status < 500) {
            throw new MailerHttpError(res.status);
          }
          retryable = new MailerHttpError(res.status);
        } catch (err) {
          if (err instanceof MailerQuotaError || err instanceof MailerHttpError) throw err;
          retryable = err instanceof Error ? err : new Error('fetch failed'); // network error or timeout
        }
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined || mailCallTimeoutMs(ATTEMPT_TIMEOUT_MS) - delay <= 0) throw retryable;
        await sleep(delay);
      }
    },
  };
}
