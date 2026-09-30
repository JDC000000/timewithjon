// src/app/api/admin/requests/route.ts — T2.2.05: GET ?tab=<tab> → one inbox tab's cards plus the Big Day meter
// (TSD T2.2; A2 reads it). Behind FEATURE_ADMIN_AUTH + requireAdmin (AD-7). Never cached: it names guests.
import { NextResponse, type NextRequest } from 'next/server';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { INBOX_TABS, type InboxTab, listRequests } from '@/features/admin/inbox';
import { bigDayMeter } from '@/features/admin/meter';
import { jsonError, noStore } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isTab = (v: string): v is InboxTab => (INBOX_TABS as readonly string[]).includes(v);

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);

  // getAll: a repeated ?tab= is refused rather than read as its first value (handoff-4 gotcha).
  const tabs = req.nextUrl.searchParams.getAll('tab');
  const tab = tabs[0] ?? 'needs_reply';
  if (tabs.length > 1 || !isTab(tab)) return noStore(jsonError(400, 'bad_tab', ERRORS.generic));

  const [{ cards, truncated }, meter] = await Promise.all([listRequests(tab), bigDayMeter()]);
  return noStore(NextResponse.json({ ok: true, tab, cards, truncated, meter }));
}
