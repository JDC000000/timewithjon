// src/app/api/admin/requests/[id]/standby/route.ts — T2.4.03: Move to stand-by → E6. Behind FEATURE_ADMIN_AUTH + requireAdmin + the Origin check
// (AD-7); the logic is in src/features/requests/standby.ts.
import type { NextRequest } from 'next/server';
import { handleStandby } from '@/features/requests/offer-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handleStandby(req, ctx);
}
