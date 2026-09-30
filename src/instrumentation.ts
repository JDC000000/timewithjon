// src/instrumentation.ts — T0.1.11: boot fails on a missing or bad variable, then Sentry (server) starts.
import { getEnv } from '@/config/env';

export async function register() {
  getEnv(); // throws "Invalid environment configuration" naming the keys (never values)
  // eslint-disable-next-line no-restricted-properties -- a Next.js runtime flag, not configuration
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('../sentry.server.config');
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
