// src/app/api/cron/tick/route.ts — T3.9.01 (AD-8): pg_cron calls this every 15 minutes through pg_net with the
// x-cron-secret header (migration 20261102000420). The secret is compared in constant time (sha256 digests, so
// the length leaks nothing); anything else is a 401 before any database work. runTick() stays under 8 s.
import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@/config/env';
import { safeEqual } from '@/features/invites/tokens';
import { runTick } from '@/features/jobs';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', getEnv().CRON_SECRET)) {
    return noStore(jsonError(401, 'unauthorized', 'Unauthorized'));
  }
  return noStore(NextResponse.json({ ok: true, ...(await runTick()) }));
}
