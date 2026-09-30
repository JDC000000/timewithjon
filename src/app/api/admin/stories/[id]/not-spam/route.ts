// src/app/api/admin/stories/[id]/not-spam/route.ts — T2.9.04: Check these → Not spam for a story (joins the list
// and counts) (TSD T2.9 AC4). Behind FEATURE_ADMIN_AUTH + requireAdmin + the Origin check (AD-7), via spamAction.
import type { NextRequest } from 'next/server';
import { markStoryNotSpam } from '@/features/admin/spam';
import { spamAction } from '@/features/admin/spam-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return spamAction(req, ctx, markStoryNotSpam);
}
