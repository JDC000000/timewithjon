// src/lib/cron-auth.ts — AD-8: pg_cron/pg_net calls carry the `x-cron-secret` header (the same header #42's
// schedules send to /api/cron/tick and /api/jobs/media), compared in constant time: both sides are hashed first,
// so the length isn't leaked either. An unset/short CRON_SECRET refuses everything (fail closed).
import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getEnv } from '@/config/env';

const digest = (s: string) => createHash('sha256').update(s).digest();
const MIN_SECRET_LENGTH = 32;

export function hasCronSecret(req: NextRequest): boolean {
  const expected = getEnv().CRON_SECRET ?? '';
  const presented = req.headers.get('x-cron-secret') ?? '';
  const same = timingSafeEqual(digest(presented), digest(expected));
  return same && expected.length >= MIN_SECRET_LENGTH;
}
