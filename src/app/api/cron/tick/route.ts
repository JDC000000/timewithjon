// src/app/api/cron/tick/route.ts — T3.9.01 (AD-8): pg_cron calls this every 15 minutes through pg_net with the
// x-cron-secret header (migration 20261102000420), checked by the one shared helper (lib/cron-auth.ts, constant
// time); anything else is a 401 before any database work. runTick() stays under 8 s.
import { NextResponse, type NextRequest } from 'next/server';
import { runTick } from '@/features/jobs';
import { hasCronSecret } from '@/lib/cron-auth';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  if (!hasCronSecret(req)) {
    return noStore(jsonError(401, 'unauthorized', 'Unauthorized'));
  }
  return noStore(NextResponse.json({ ok: true, ...(await runTick()) }));
}
