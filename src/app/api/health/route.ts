// src/app/api/health/route.ts — T3.14.01 (TSD T3.14): 200 when every check passes, 503 naming the failing ones.
// Public (UptimeRobot, T3.14.03), so the body says only ok/fail per check; the reason codes and warnings
// (jobs/health.ts) are served only to a caller with the cron secret (T3.14.01).
import { NextResponse, type NextRequest } from 'next/server';
import { cachedHealthReport, publicHealthBody } from '@/features/jobs/health';
import { hasCronSecret } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const report = await cachedHealthReport();
  return NextResponse.json(hasCronSecret(req) ? report : publicHealthBody(report), {
    status: report.ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
