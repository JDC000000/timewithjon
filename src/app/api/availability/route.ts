// src/app/api/availability/route.ts — GET ?dish=slug -> the C3 output shape ONLY (no cap, no counts).
// T2.7.02: the manage grant opens the picker for its own request's dish only, with that request's own booking
// and offers not hiding anything from it (Ask for another time).
import { NextResponse, type NextRequest } from 'next/server';
import { dishBySlug } from '@/content/menu-helpers';
import { getBusy } from '@/features/availability/busy';
import { engineInput, loadEngineData, withoutOwnBooking } from '@/features/availability/load';
import { ERRORS } from '@/content';
import { openWindows } from '@/features/availability/openWindows';
import { jsonError } from '@/lib/http';
import { requireInviteOrManage } from '@/features/invites/require';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = await requireInviteOrManage(req);
  if ('response' in gate) return gate.response;
  const dish = dishBySlug(req.nextUrl.searchParams.get('dish') ?? '');
  if (!dish) return jsonError(404, 'unknown_dish', 'Not on the menu.');
  if (gate.manageDish !== null && gate.manageDish !== dish.slug)
    return jsonError(403, 'manage_other_dish', ERRORS.generic);
  const loaded = withoutOwnBooking(await loadEngineData(), gate.manageRequestId);
  const busy = await getBusy({ start: loaded.settings.seasonStart, end: loaded.settings.seasonEnd });
  const out = openWindows(
    engineInput(loaded, busy, gate.invite.kind, dish.windows, gate.manageRequestId ?? undefined),
  );
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
