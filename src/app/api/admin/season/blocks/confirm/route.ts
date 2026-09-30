// src/app/api/admin/season/blocks/confirm/route.ts — T2.5.02 (TSD T2.5 AC3). Behind FEATURE_ADMIN_AUTH + requireAdmin (AD-7); the logic is in block-confirm.ts.
import type { NextRequest } from 'next/server';
import { postBlockConfirm } from '@/features/admin/season-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (req: NextRequest) => postBlockConfirm(req);
