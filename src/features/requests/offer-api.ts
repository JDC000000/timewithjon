// src/features/requests/offer-api.ts — T2.4 admin route handlers (Suggest another time, and the other offer
// actions). requireAdmin (feature flag, Origin, session) → the id → Zod → the service → 404/409 with a code.
// Never cached. No UI here: the sheets that call these are T2.4.U1 (after G1).
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { jsonError, noStore } from '@/lib/http';
import { RangeFields, rangeFrom } from './lock-api';
import { MAX_OFFER_OPTIONS, type OfferRange } from './offers';
import { replyToPitch, weatherCall } from './pitch-weather';
import { moveToStandby, offerStandbyWindow } from './standby';
import { suggestTimes, type OfferActionResult, type SuggestOptions } from './suggest';

type Ctx = { params: Promise<{ id: string }> };

/** Jon's optional opening line for E5 ("Thursday went before I could grab it."). */
const Lead = z.string().trim().max(300).default('');
export const SuggestBody = z.union([
  z.strictObject({
    slotIds: z
      .array(z.uuid())
      .min(1)
      .max(MAX_OFFER_OPTIONS)
      .refine((a) => new Set(a).size === a.length, 'duplicate slot'), // pr46-review L4
    lead: Lead,
  }),
  z.strictObject({ ranges: z.array(z.strictObject(RangeFields)).min(1).max(MAX_OFFER_OPTIONS), lead: Lead }),
]);

/** Vancouver wall clock → ranges; null when one doesn't exist (a DST gap). */
export function rangesFrom(rs: Parameters<typeof rangeFrom>[0][]): OfferRange[] | null {
  const out = rs.map(rangeFrom);
  return out.every((r) => r !== null) ? (out as OfferRange[]) : null;
}

/** The shared admin gate + id + body parse. */
export async function adminOfferRoute<S extends z.ZodType>(
  req: NextRequest,
  ctx: Ctx,
  schema: S,
  run: (id: string, body: z.infer<S>) => Promise<OfferActionResult | null>,
): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return noStore(jsonError(404, 'not_found', ERRORS.generic));
  const parsed = schema.safeParse(await req.json().catch(() => null));
  const res = parsed.success ? await run(id, parsed.data) : null;
  if (!res) return noStore(jsonError(400, 'invalid', ERRORS.generic));
  if (res.ok) return noStore(NextResponse.json({ ok: true, offerId: res.offerId ?? null }));
  return noStore(jsonError(res.status, res.reason, ERRORS.generic));
}

export function handleSuggest(req: NextRequest, ctx: Ctx): Promise<Response> {
  return adminOfferRoute(req, ctx, SuggestBody, async (id, b) => {
    let options: SuggestOptions;
    if ('slotIds' in b) options = { slotIds: b.slotIds };
    else {
      const ranges = rangesFrom(b.ranges);
      if (!ranges) return null;
      options = { ranges };
    }
    return suggestTimes(id, options, b.lead);
  });
}

/** T2.4.03: any date in the stand-by week. */
export const StandbyBody = z.strictObject({ week: z.iso.date() });
export function handleStandby(req: NextRequest, ctx: Ctx): Promise<Response> {
  return adminOfferRoute(req, ctx, StandbyBody, (id, b) => moveToStandby(id, b.week));
}

/** T2.4.04: one window (a slot, or a range for a dates-mode dish); `override` = L13's Override tick. */
const Override = { override: z.boolean().default(false) };
export const StandbyOfferBody = z.union([
  z.strictObject({ slotId: z.uuid(), ...Override }),
  z.strictObject({ ...RangeFields, ...Override }),
]);
export function handleStandbyOffer(req: NextRequest, ctx: Ctx): Promise<Response> {
  return adminOfferRoute(req, ctx, StandbyOfferBody, async (id, b) => {
    if ('slotId' in b) return offerStandbyWindow(id, { slotId: b.slotId }, b.override);
    const range = rangeFrom(b);
    return range ? offerStandbyWindow(id, range, b.override) : null;
  });
}

/** T2.4.05: E8 names how big the pitch is in Jon's words ("three days long"); E9 is the honest no. */
export const PitchBody = z.union([
  z.strictObject({ reply: z.literal('smaller'), length: z.string().trim().min(1).max(60) }),
  z.strictObject({ reply: z.literal('no') }),
]);
export function handlePitch(req: NextRequest, ctx: Ctx): Promise<Response> {
  return adminOfferRoute(req, ctx, PitchBody, (id, b) => replyToPitch(id, b));
}

/** T2.4.06: no body fields. */
export const WeatherBody = z.strictObject({});
export function handleWeather(req: NextRequest, ctx: Ctx): Promise<Response> {
  return adminOfferRoute(req, ctx, WeatherBody, (id) => weatherCall(id));
}
