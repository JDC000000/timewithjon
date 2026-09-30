// src/app/api/admin/requests/[id]/weather/route.ts — T2.4.06. Behind FEATURE_ADMIN_AUTH + requireAdmin + the Origin
// check (AD-7); the logic is in src/features/requests/ Weather call → delete the event + E10 with a pick-a-new-date link:pitch-weather.ts.
import type { NextRequest } from 'next/server';
import { handleWeather } from '@/features/requests/offer-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handleWeather(req, ctx);
}
