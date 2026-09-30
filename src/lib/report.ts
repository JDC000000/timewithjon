// src/lib/report.ts — one place for "fail open, but leave a trace" (AD-11, review T4.2.00 M6).
// Sentry (scrubbed by src/lib/sentry-scrub.ts) plus a structured console line so Vercel logs show it even
// before Sentry is wired (T0.1.11). Only the area, tags and the error CLASS name: never a message, since
// driver and SDK messages can carry emails or tokens.
import * as Sentry from '@sentry/nextjs';

export function errorName(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}

export function report(e: unknown, tags: Record<string, string>): void {
  Sentry.captureException(e, { tags });
  console.warn(JSON.stringify({ level: 'warn', event: 'fail_open', error: errorName(e), ...tags }));
}

/** For fixed, code-authored warning strings only (never interpolate user data into `message`). */
export function reportMessage(message: string, tags: Record<string, string>): void {
  Sentry.captureMessage(message, { level: 'warning', tags });
  console.warn(JSON.stringify({ level: 'warn', event: 'fail_open', message, ...tags }));
}
