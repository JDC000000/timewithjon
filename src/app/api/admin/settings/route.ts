// src/app/api/admin/settings/route.ts — T2.9.02: GET the A7 settings + counts (people reached, M9), PATCH the
// editable settings (TSD T2.9 AC2). Behind FEATURE_ADMIN_AUTH + requireAdmin + the Origin check (AD-7).
import { NextResponse, type NextRequest } from 'next/server';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { adminCounts, readSettings, SettingsPatch, updateSettings } from '@/features/admin/settings';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const [settings, counts] = await Promise.all([readSettings(), adminCounts()]);
  return noStore(NextResponse.json({ ok: true, settings, counts }));
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const parsed = SettingsPatch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return noStore(jsonError(400, 'invalid', ERRORS.generic));
  const res = await updateSettings(parsed.data);
  if (!res.ok) return noStore(jsonError(400, res.reason, ERRORS.generic));
  return noStore(NextResponse.json({ ok: true, settings: res.settings }));
}
