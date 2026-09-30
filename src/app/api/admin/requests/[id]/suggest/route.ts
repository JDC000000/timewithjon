// src/app/api/admin/requests/[id]/suggest/route.ts — T2.4.02: Suggest another time → E5. Behind
// FEATURE_ADMIN_AUTH + requireAdmin + the Origin check (AD-7); the logic is suggestTimes().
import type { NextRequest } from 'next/server';
import { handleSuggest } from '@/features/requests/offer-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handleSuggest(req, ctx);
}
