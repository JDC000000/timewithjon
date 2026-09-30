// src/app/api/admin/season/weeks/[weekStart]/route.ts — T2.5 (TSD T2.5, A4). Behind FEATURE_ADMIN_AUTH + requireAdmin (AD-7); the logic is in season-api.ts.
import type { NextRequest } from 'next/server';
import { getWeekWindows, patchWeek } from '@/features/admin/season-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (req: NextRequest, ctx: { params: Promise<{ weekStart: string }> }) =>
  getWeekWindows(req, ctx);

export const PATCH = (req: NextRequest, ctx: { params: Promise<{ weekStart: string }> }) =>
  patchWeek(req, ctx);
