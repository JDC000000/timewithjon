// src/lib/adapters/google/http.ts — the one fetch wrapper for Google's REST APIs (AD-6). A thin REST client
// instead of the googleapis package: five endpoints don't justify its size in a Vercel function (AGENTS rule 10).
// Every call has a 15 s AbortSignal timeout, well under the outbox's 5-minute claim lease (pr28 review L4).
// Errors carry the HTTP status and Google's short reason code only: never a body, a token or an email.
import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';

export const GOOGLE_TIMEOUT_MS = 15_000;

/** pr57 F2: an optional hard stop (epoch ms) for every Google call made inside withGoogleDeadline. */
const deadlineStore = new AsyncLocalStorage<number>();

/** Runs `fn` so that no Google call inside it (retry waits included) goes past `deadlineAt` (epoch ms). */
export function withGoogleDeadline<T>(deadlineAt: number, fn: () => Promise<T>): Promise<T> {
  return deadlineStore.run(deadlineAt, fn);
}

/** Past the hard stop: named like fetch's own timeout, so it's retryable and recorded as 'TimeoutError'. */
export class GoogleDeadlineError extends Error {
  override name = 'TimeoutError';
}

/** This call's timeout: 15 s, or less when a hard stop is closer. <= 0 = no time left. */
function callTimeoutMs(): number {
  const deadline = deadlineStore.getStore();
  return deadline === undefined ? GOOGLE_TIMEOUT_MS : Math.min(GOOGLE_TIMEOUT_MS, deadline - Date.now());
}

export class GoogleApiError extends Error {
  override name = 'GoogleApiError';
  constructor(
    readonly status: number,
    /** Google's machine code, e.g. 'invalid_grant', 'notFound', 'duplicate'; '' if none was given. */
    readonly reason: string,
    readonly op: string,
  ) {
    super(`Google ${op} failed: ${status} ${reason}`.trim());
  }
}

/**
 * T3.14.02: a dead grant (revoked, expired, password change) or a refused access token. NOT `invalid_client`
 * (a wrong client id/secret, pr35 F6): that is a config error, and E14 "reconnect" would not fix it.
 */
export function isGoogleAuthFailure(e: unknown): boolean {
  if (!(e instanceof GoogleApiError) || isGoogleConfigError(e)) return false;
  return e.status === 401 || e.reason === 'invalid_grant';
}

/** Our OAuth client itself is refused (wrong secret, deleted client): an operator fix, never Jon's reconnect. */
export function isGoogleConfigError(e: unknown): boolean {
  return e instanceof GoogleApiError && (e.reason === 'invalid_client' || e.reason === 'unauthorized_client');
}

const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

/** A failure worth trying again later (pr35 F6): 5xx, 429, a 403 rate limit, or a timeout/abort/network error. */
export function isGoogleRetryable(e: unknown): boolean {
  if (e instanceof GoogleApiError) {
    return e.status >= 500 || e.status === 429 || (e.status === 403 && RATE_REASONS.has(e.reason));
  }
  if (e instanceof TypeError) return true; // fetch's network failure
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

function reasonOf(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const b = body as { error?: unknown };
  if (typeof b.error === 'string') return b.error.slice(0, 40); // OAuth endpoints: { error: 'invalid_grant' }
  const api = b.error as { errors?: { reason?: unknown }[]; status?: unknown } | undefined;
  const reason = api?.errors?.[0]?.reason ?? api?.status;
  return typeof reason === 'string' ? reason.slice(0, 40) : '';
}

export interface GoogleRequest {
  op: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  accessToken?: string;
  json?: unknown;
  form?: Record<string, string>;
  /** The resource's etag: Google answers 412 when it changed since (a guest answered in between). */
  ifMatch?: string;
}

/** One in-request retry, short enough for a Vercel function; the outbox/job retries the rest (pr35 F6). */
export const GOOGLE_MAX_ATTEMPTS = 2;
const MAX_RETRY_WAIT_MS = 2_000;

function retryWaitMs(retryAfter: string | null, attempt: number): number {
  const seconds = Number(retryAfter);
  if (retryAfter && Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
  return Math.min(250 * 2 ** (attempt - 1), MAX_RETRY_WAIT_MS);
}

/**
 * Returns the parsed JSON body (undefined for 204), or throws GoogleApiError. A 5xx/429/403-rate-limit answer is
 * retried once after a bounded backoff (Retry-After honoured up to 2 s). A timeout is not retried in-request:
 * it has already used 15 s. Every call here is safe to repeat (token calls; event ids are deterministic).
 */
export async function googleFetch<T>(url: string, req: GoogleRequest): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await googleFetchOnce<T>(url, req);
    } catch (e) {
      const wait = e instanceof GoogleRetryableAnswer ? retryWaitMs(e.retryAfter, attempt) : 0;
      if (
        !(e instanceof GoogleRetryableAnswer) ||
        attempt >= GOOGLE_MAX_ATTEMPTS ||
        callTimeoutMs() - wait <= 0 // the retry couldn't finish before the hard stop
      ) {
        throw e instanceof GoogleRetryableAnswer ? e.error : e;
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

class GoogleRetryableAnswer extends Error {
  constructor(
    readonly error: GoogleApiError,
    readonly retryAfter: string | null,
  ) {
    super(error.message);
  }
}

async function googleFetchOnce<T>(url: string, req: GoogleRequest): Promise<T> {
  const timeoutMs = callTimeoutMs();
  if (timeoutMs <= 0) throw new GoogleDeadlineError(`Google ${req.op} not started: past the hard stop`);
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: string | undefined;
  if (req.accessToken) headers.authorization = `Bearer ${req.accessToken}`;
  if (req.ifMatch) headers['if-match'] = req.ifMatch;
  if (req.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(req.form).toString();
  } else if (req.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(req.json);
  }
  const res = await fetch(url, {
    method: req.method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const error = new GoogleApiError(res.status, reasonOf(parsed), req.op);
    if (isGoogleRetryable(error)) throw new GoogleRetryableAnswer(error, res.headers.get('retry-after'));
    throw error;
  }
  return parsed as T;
}
