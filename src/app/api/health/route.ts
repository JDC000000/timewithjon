// src/app/api/health/route.ts — T3.14.01 (TSD T3.14): 200 when every check passes, 503 naming the failing ones.
// Public (UptimeRobot, T3.14.03), so the body carries check names and reason codes only (jobs/health.ts).
import { NextResponse } from 'next/server';
import { cachedHealthReport } from '@/features/jobs/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const report = await cachedHealthReport();
  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
