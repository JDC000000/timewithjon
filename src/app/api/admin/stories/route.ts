// src/app/api/admin/stories/route.ts — T2.9.01: GET the A6 stories list (TSD T2.9). Behind FEATURE_ADMIN_AUTH +
// requireAdmin (AD-7). Never cached: it holds guests' stories and emails.
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/features/admin/auth';
import { listStories } from '@/features/admin/stories';
import { noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  return noStore(NextResponse.json({ ok: true, ...(await listStories()) }));
}
