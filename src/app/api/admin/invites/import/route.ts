// src/app/api/admin/invites/import/route.ts — T5.1.02 (TSD T5.1 AC2). Behind FEATURE_ADMIN_AUTH + requireAdmin (AD-7); the logic is in invites-api.ts.
import type { NextRequest } from 'next/server';
import { postInviteImport } from '@/features/admin/invites-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (req: NextRequest) => postInviteImport(req);
