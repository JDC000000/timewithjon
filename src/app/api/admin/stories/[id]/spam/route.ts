// src/app/api/admin/stories/[id]/spam/route.ts — T2.9.04: Check these → Delete a spam-suspect story (only spam, no
// photos) (TSD T2.9 AC4). Behind FEATURE_ADMIN_AUTH + requireAdmin + the Origin check (AD-7), via spamAction.
import type { NextRequest } from 'next/server';
import { deleteSpamStory } from '@/features/admin/spam';
import { spamAction } from '@/features/admin/spam-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return spamAction(req, ctx, deleteSpamStory);
}
