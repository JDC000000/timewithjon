// src/lib/adapters/gmail/mailer.ts — T3.17.01: GmailApiMailer (users.messages.send). Staging sends from the test
// Gmail; production can fall back to Jon's Gmail (AD-5 rule 7) by flipping system_status.mailer_mode.
// Gmail has no idempotency key, so this mailer never retries on its own: the email_log claim is the guard, and
// the tick's +5/+15/+30 min retry is the only retry. Gmail rewrites From to the sending account (or a send-as alias).
// T3.9.01: every send has a 10 s timeout (less under the tick's hard stop), so a hung socket can't hold the request
// past its function limit. A send Gmail accepted whose answer was lost is retried and may arrive twice: an accepted
// risk on this fallback (AGENTS.md, Stack).
import 'server-only';
import { MailerHttpError, MailerNotConfiguredError, MailerQuotaError } from '../errors';
import { MailDeadlineError, mailCallTimeoutMs } from '../mail-deadline';
import type { Mailer } from '../types';
import { base64url, buildMime } from './mime';

export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const QUOTA_REASONS = new Set(['dailyLimitExceeded', 'quotaExceeded']);
/** pr36 F3: the token can't send (revoked, expired, or no gmail.send scope). A config error, not a retry. */
const AUTH_REASONS = new Set(['insufficientPermissions', 'authError']);
/** pr36 F2: Gmail's sending-limit lockout ("… (Mail sending)") is a quota, as is a retry more than 1 h away. */
const SENDING_LIMIT = /\(Mail sending\)|sending limit/i;
const QUOTA_RETRY_MS = 60 * 60_000;
export const GMAIL_TIMEOUT_MS = 10_000;
/**
 * The least time a Gmail send needs before the hard stop to start at all. Gmail has no idempotency key: a send it
 * accepted whose answer is cut off is sent again by the next tick and arrives twice, so with less time than this left
 * the send waits for the next tick instead (a retryable TimeoutError, nothing sent).
 */
export const GMAIL_MIN_START_MS = 5_000;

export interface GmailOptions {
  /** An OAuth access token for the connected account with the gmail.send scope. */
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
  now?: () => Date;
}

interface GmailError {
  reasons: string[];
  message: string;
}

async function readError(res: Response): Promise<GmailError> {
  try {
    const body = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
    return {
      reasons: body.error?.errors?.map((e) => e.reason ?? '') ?? [],
      message: body.error?.message ?? '',
    };
  } catch {
    return { reasons: [], message: '' };
  }
}

/** When Gmail says to try again: "Retry after <ISO time>" in the message, or a Retry-After header (s or date). */
function retryAt(res: Response, message: string, now: Date): number | null {
  const inMessage = /Retry after (\S+?)(?:[\s)]|$)/i.exec(message)?.[1];
  const header = res.headers.get('retry-after');
  const candidates = [
    inMessage ? Date.parse(inMessage) : NaN,
    header && /^\d+$/.test(header)
      ? now.getTime() + Number(header) * 1000
      : header
        ? Date.parse(header)
        : NaN,
  ].filter((t) => Number.isFinite(t));
  return candidates.length ? Math.max(...candidates) : null;
}

function isQuota(res: Response, err: GmailError, now: Date): boolean {
  if (res.status !== 429 && res.status !== 403) return false;
  if (err.reasons.some((r) => QUOTA_REASONS.has(r))) return true;
  if (/daily .*limit/i.test(err.message) || SENDING_LIMIT.test(err.message)) return true;
  const at = retryAt(res, err.message, now);
  return at !== null && at - now.getTime() > QUOTA_RETRY_MS;
}

function isAuth(res: Response, err: GmailError): boolean {
  return res.status === 401 || (res.status === 403 && err.reasons.some((r) => AUTH_REASONS.has(r)));
}

export function createGmailApiMailer(opts: GmailOptions): Mailer {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  return {
    async send(e) {
      const token = await opts.getAccessToken(); // first: no token, nothing built or sent
      const raw = base64url(buildMime({ ...e, date: now() }));
      const timeoutMs = mailCallTimeoutMs(GMAIL_TIMEOUT_MS);
      if (timeoutMs < GMAIL_MIN_START_MS)
        throw new MailDeadlineError('gmail send not started: too close to the hard stop');
      const res = await doFetch(GMAIL_SEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const { id } = (await res.json()) as { id?: unknown };
        // pr36 F10: a 200 without an id is not a send we can track. Treated as a server error (retried).
        if (typeof id !== 'string' || !id) throw new MailerHttpError(502);
        return { id: `gmail:${id}` };
      }
      const err = await readError(res);
      if (isQuota(res, err, now())) throw new MailerQuotaError('gmail quota');
      if (isAuth(res, err)) throw new MailerNotConfiguredError('gmail auth');
      throw new MailerHttpError(res.status);
    },
  };
}
