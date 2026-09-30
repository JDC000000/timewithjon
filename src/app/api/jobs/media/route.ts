// src/app/api/jobs/media/route.ts — T3.6.04 (TSD M5): pg_cron + pg_net every 5 minutes (timeout 120 s).
// Processes the outbox kinds r2_copy and attachment_finalise for up to 90 s. x-cron-secret only: a 401 before
// any database read (src/lib/cron-auth.ts).
import { NextResponse, type NextRequest } from 'next/server';
import { runMediaJob } from '@/features/jobs/media';
import { photoBackup, photoStore } from '@/lib/adapters/photos';
import { hasCronSecret } from '@/lib/cron-auth';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!hasCronSecret(req)) return noStore(jsonError(401, 'unauthorized', 'Unauthorized'));
  return noStore(NextResponse.json(await runMediaJob({ store: photoStore(), backup: photoBackup() })));
}
