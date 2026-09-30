// src/features/admin/season-api.ts — T2.5.01/.03 handlers for /api/admin/season/**. Each one: requireAdmin
// (feature flag, Origin on writes, session) → Zod → the season service → JSON. Never cached.
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { jsonError, noStore } from '@/lib/http';
import { isThuFri } from '@/features/availability/rules';
import { requireAdmin } from './auth';
import { confirmBlock, ConfirmBlockBody } from './block-confirm';
import {
  block,
  BlockBody,
  CapBody,
  previewBlock,
  releaseHousehold,
  type SeasonResult,
  setCapOverride,
  unblock,
} from './season';
import { seasonView } from './season-view';
import { weekWindows } from './season-windows';

type Ctx<K extends string> = { params: Promise<Record<K, string>> };

const invalid = () => noStore(jsonError(400, 'invalid', ERRORS.generic));
const notFound = () => noStore(jsonError(404, 'not_found', ERRORS.generic));
const body = (req: NextRequest) => req.json().catch(() => null);

function respond(res: SeasonResult | Awaited<ReturnType<typeof confirmBlock>>, status = 200): Response {
  if (res.ok) return noStore(NextResponse.json(res, { status }));
  if ('affected' in res) {
    const out = {
      ok: false,
      code: res.reason,
      message: ERRORS.generic,
      affected: res.affected,
      underWay: res.underWay,
    };
    return noStore(NextResponse.json(out, { status: 409 }));
  }
  return noStore(jsonError(res.status, res.reason, ERRORS.generic));
}

/** GET /api/admin/season: the A4 view. */
export async function getSeason(req: NextRequest): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  return noStore(NextResponse.json({ ok: true, ...(await seasonView()) }));
}

/** POST /api/admin/season/blocks: add a block or away range (409 + the affected bookings over a lock; both carry underWay). */
export async function postBlock(req: NextRequest): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const parsed = BlockBody.safeParse(await body(req));
  if (!parsed.success) return invalid();
  return respond(await block(parsed.data), 201);
}

/**
 * POST /api/admin/season/blocks/confirm { block, bookings: [{ requestId, slotIds? | ranges? }] } (T2.5.02): add
 * the block and move each booking it covers to needs_new_time with E5b. 409 locked_bookings + the new list when
 * the bookings changed since the preview; 404 slot_not_found / 409 in_the_past / 409 in_block for a bad offered time.
 */
export async function postBlockConfirm(req: NextRequest): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const parsed = ConfirmBlockBody.safeParse(await body(req));
  if (!parsed.success) return invalid();
  return respond(await confirmBlock(parsed.data), 201);
}

/** The preview's query; `window` (T2.5.06) is left out (or empty) for the whole day(s), as A4's per-date editor does. */
const PreviewQuery = z.strictObject({
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  window: z.enum(['lunch', 'evening']).nullable(),
});

/**
 * GET /api/admin/season/blocks/preview?startDate=&endDate=[&window=lunch|evening]: what a block there would move
 * (`affected`) and the bookings under way it leaves to finish (`underWay`, T2.5.05); with `window`, a block on that
 * one window of the date (T2.5.06: one date only). Read-only.
 */
export async function getBlockPreview(req: NextRequest): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const sp = req.nextUrl.searchParams;
  const parsed = PreviewQuery.safeParse({
    startDate: sp.get('startDate'),
    endDate: sp.get('endDate'),
    window: sp.get('window') || null,
  });
  if (!parsed.success) return invalid();
  const { startDate, endDate, window } = parsed.data;
  // pr85 L1: a window preview is one Thu/Fri, exactly as POST /blocks accepts it.
  if (endDate < startDate || (window !== null && (endDate !== startDate || !isThuFri(startDate)))) {
    return invalid();
  }
  const preview = await previewBlock(startDate, endDate, new Date(), window);
  return noStore(NextResponse.json({ ok: true, ...preview }));
}

/** DELETE /api/admin/season/blocks/[id] */
export async function deleteBlock(req: NextRequest, ctx: Ctx<'id'>): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();
  return respond(await unblock(id));
}

/** GET /api/admin/season/weeks/[weekStart]: each Thu/Fri window's block state (T2.5.06); 404 for a non-season week. */
export async function getWeekWindows(req: NextRequest, ctx: Ctx<'weekStart'>): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const { weekStart } = await ctx.params;
  if (!z.iso.date().safeParse(weekStart).success) return notFound();
  const windows = await weekWindows(weekStart);
  if (!windows) return notFound();
  return noStore(NextResponse.json({ ok: true, weekStart, windows }));
}

/** PATCH /api/admin/season/weeks/[weekStart] { capOverride: 0..10 | null } */
export async function patchWeek(req: NextRequest, ctx: Ctx<'weekStart'>): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const { weekStart } = await ctx.params;
  if (!z.iso.date().safeParse(weekStart).success) return notFound();
  const parsed = CapBody.safeParse(await body(req));
  if (!parsed.success) return invalid();
  return respond(await setCapOverride(weekStart, parsed.data.capOverride));
}

/** POST /api/admin/season/household-hold: release the Thu Apr 1 lunch hold (one-way). */
export async function postHouseholdRelease(req: NextRequest): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  return respond(await releaseHousehold());
}
