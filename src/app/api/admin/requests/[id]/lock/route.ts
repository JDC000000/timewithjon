// src/app/api/admin/requests/[id]/lock/route.ts — T2.3.04: Lock it in (TSD T2.3). Behind FEATURE_ADMIN_AUTH +
// requireAdmin + the Origin check (AD-7); the logic is lockRequest() (T2.3.03).
import type { NextRequest } from 'next/server';
import { handleLock } from '@/features/requests/lock-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handleLock(req, ctx, 'lock');
}
