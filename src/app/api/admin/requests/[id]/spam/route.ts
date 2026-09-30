// src/app/api/admin/requests/[id]/spam/route.ts — T2.9.04: Check these → Delete a spam-suspect request (only spam)
// (TSD T2.9 AC4). Behind FEATURE_ADMIN_AUTH + requireAdmin + the Origin check (AD-7), via spamAction.
import type { NextRequest } from 'next/server';
import { deleteSpamRequest } from '@/features/admin/spam';
import { spamAction } from '@/features/admin/spam-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return spamAction(req, ctx, deleteSpamRequest);
}
