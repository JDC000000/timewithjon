// src/app/api/admin/requests/[id]/close-in-person/route.ts — Close (handled in person) (T2.10.02). Behind FEATURE_ADMIN_AUTH + requireAdmin + the
// Origin check (AD-7); the logic is in src/features/requests (joined-api.ts).
import type { NextRequest } from 'next/server';
import { handleCloseInPerson } from '@/features/requests/joined-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handleCloseInPerson(req, ctx);
}
