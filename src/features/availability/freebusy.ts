// src/lib/engine/freebusy.ts — C3 rule 7: free/busy fails open. Pure decision function.
import type { BusyInterval } from './types';

export const FREEBUSY_TTL_MS = 10 * 60 * 1000;
export const FREEBUSY_STALE_MAX_MS = 24 * 60 * 60 * 1000;

export interface BusyResolution {
  busy: BusyInterval[] | null;
  warning: string | null;
  refetch: boolean;
}

export function resolveBusy(args: {
  now: Date;
  cache: { fetchedAt: Date; busy: BusyInterval[] } | null;
  fetchResult?: { ok: true; busy: BusyInterval[] } | { ok: false; error: string };
}): BusyResolution {
  const { now, cache, fetchResult } = args;
  const age = cache ? now.getTime() - cache.fetchedAt.getTime() : Infinity;
  if (!fetchResult) {
    // No fetch attempted: fresh cache wins, otherwise ask the caller to fetch.
    return age < FREEBUSY_TTL_MS
      ? { busy: cache!.busy, warning: null, refetch: false }
      : { busy: cache?.busy ?? null, warning: null, refetch: true };
  }
  if (fetchResult.ok) return { busy: fetchResult.busy, warning: null, refetch: false };
  if (cache && age < FREEBUSY_STALE_MAX_MS) {
    return { busy: cache.busy, warning: `freebusy_failed_using_cache: ${fetchResult.error}`, refetch: false };
  }
  return { busy: null, warning: `freebusy_failed_no_filter: ${fetchResult.error}`, refetch: false };
}
