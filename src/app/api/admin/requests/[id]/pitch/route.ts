// src/app/api/admin/requests/[id]/pitch/route.ts — T2.4.05. Behind FEATURE_ADMIN_AUTH + requireAdmin + the Origin
// check (AD-7); the logic is in src/features/requests/ About your pitch → E8 (the smaller version) or E9 (an honest no):pitch-weather.ts.
import type { NextRequest } from 'next/server';
import { handlePitch } from '@/features/requests/offer-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handlePitch(req, ctx);
}
