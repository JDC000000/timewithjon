// src/config/public-env.ts — the NEXT_PUBLIC_* values the browser bundle needs. Next.js inlines these at build
// time; server code keeps using getEnv(). Only public, non-secret values belong here.
import type { AppMode } from './env';

export const publicEnv = {
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  // Copied from APP_MODE at build time by next.config.ts (`env`), not a separately configured variable.
  // next.config.ts fails the build unless APP_MODE is a valid mode (review L3), so the cast holds.
  APP_MODE: process.env.NEXT_PUBLIC_APP_MODE as AppMode,
};
