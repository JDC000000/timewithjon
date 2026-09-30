// src/app/api/admin/requests/[id]/join/route.ts — Join to booking (T2.10.01). Behind FEATURE_ADMIN_AUTH + requireAdmin + the
// Origin check (AD-7); the logic is in src/features/requests (joined-api.ts).
import type { NextRequest } from 'next/server';
import { handleJoin } from '@/features/requests/joined-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handleJoin(req, ctx);
}
