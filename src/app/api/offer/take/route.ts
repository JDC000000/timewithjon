// src/app/api/offer/take/route.ts — T2.4.07 S18 POST: the guest takes an offered time. The Origin check, then the
// per-IP limit (offerTake), then the body with the shared honeypot (AD-9: a filled one is recorded, never refused),
// before any token work. The single-use token rides in the body, never in this URL. Never cached.
import { NextResponse, type NextRequest } from 'next/server';
import { ERRORS } from '@/content';
import { loadOfferModel } from '@/features/invites/manage-model';
import { TakeBody, stillOpen, takeOffer } from '@/features/requests/take-offer';
import { isHoneypotFilled } from '@/lib/honeypot';
import { BODY_TOO_LARGE, jsonError, readJson, sameOrigin, tokenNoStore, tooLarge } from '@/lib/http';
import { limitByIp } from '@/lib/ratelimit';
import { offerAnswer } from '@/features/requests/offer-answer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return tokenNoStore(jsonError(403, 'bad_origin', ERRORS.generic));
  const limited = await limitByIp(req, 'offerTake');
  if (limited) return tokenNoStore(limited);
  const body = await readJson(req); // bounded: a body over MAX_JSON_BYTES is never read whole
  if (body === BODY_TOO_LARGE) return tokenNoStore(tooLarge(ERRORS.generic));
  const parsed = TakeBody.safeParse(body);
  if (!parsed.success) return tokenNoStore(jsonError(400, 'invalid', ERRORS.generic));
  const res = await takeOffer(parsed.data, isHoneypotFilled(parsed.data.hp));
  if (res === 'invalid') return tokenNoStore(jsonError(400, 'invalid', ERRORS.generic));
  const model = await loadOfferModel(parsed.data.token);
  if (res === 'refused' && model.kind === 'offer') {
    const windows = await stillOpen(model.requestId, model.windows, model.offerKind);
    return tokenNoStore(
      NextResponse.json(
        { ok: false, code: 'offer_gone', message: ERRORS.offerGone, windows },
        { status: 409 },
      ),
    );
  }
  return offerAnswer(model);
}
