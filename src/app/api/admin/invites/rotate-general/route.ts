// src/app/api/admin/invites/rotate-general/route.ts — T2.6 (TSD T2.6, A5). Behind FEATURE_ADMIN_AUTH + requireAdmin (AD-7); the logic is in invites-api.ts.
import type { NextRequest } from 'next/server';
import { postRotateGeneral } from '@/features/admin/invites-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (req: NextRequest) => postRotateGeneral(req);
