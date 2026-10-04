// src/lib/adapters/mail-deadline.ts — T3.9.01 (AD-8): an optional hard stop (epoch ms) for every mailer call made
// inside withMailDeadline, the mailer twin of withGoogleDeadline (google/http.ts). The tick sets it, so one slow
// send can't outlive the function and lose the heartbeat and every later job. Outside it, mailers keep their own
// per-attempt timeout.
import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';

const deadlineStore = new AsyncLocalStorage<number>();

/** Runs `fn` so that no mailer call inside it (retry waits included) goes past `deadlineAt` (epoch ms). */
export function withMailDeadline<T>(deadlineAt: number, fn: () => Promise<T>): Promise<T> {
  return deadlineStore.run(deadlineAt, fn);
}

/** Past the hard stop: named like fetch's own timeout, so the send path records it as a retryable 'TimeoutError'. */
export class MailDeadlineError extends Error {
  override name = 'TimeoutError';
}

/** This attempt's timeout: `ownMs`, or less when a hard stop is closer. <= 0 = no time left. */
export function mailCallTimeoutMs(ownMs: number): number {
  const deadline = deadlineStore.getStore();
  return deadline === undefined ? ownMs : Math.min(ownMs, deadline - Date.now());
}
