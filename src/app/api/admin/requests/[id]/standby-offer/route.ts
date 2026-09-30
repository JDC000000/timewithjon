// src/app/api/admin/requests/[id]/standby-offer/route.ts — T2.4.04: Offer a freed window to one stand-by guest → E7 (48 h). Behind FEATURE_ADMIN_AUTH + requireAdmin + the Origin check
// (AD-7); the logic is in src/features/requests/standby.ts.
import type { NextRequest } from 'next/server';
import { handleStandbyOffer } from '@/features/requests/offer-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handleStandbyOffer(req, ctx);
}
