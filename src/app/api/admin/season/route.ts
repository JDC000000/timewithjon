// src/app/api/admin/season/route.ts — T2.5 (TSD T2.5, A4). Behind FEATURE_ADMIN_AUTH + requireAdmin (AD-7); the logic is in season-api.ts.
import type { NextRequest } from 'next/server';
import { getSeason } from '@/features/admin/season-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (req: NextRequest) => getSeason(req);
