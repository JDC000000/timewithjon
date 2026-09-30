// src/app/api/offer/propose/route.ts — T2.4.08 S18 POST: the guest proposes new times or dates (an offer that
// doesn't suit, or after a weather call). The Origin check, then the per-IP limit (offerTake), then the body with
// the shared honeypot (AD-9: a filled one is stored as spam_suspect with no E16, never refused), before any token
// work. The single-use token rides in the body, never in this URL. Never cached, never a Referer.
import { NextResponse, type NextRequest } from 'next/server';
import { ERRORS } from '@/content';
import { findToken } from '@/features/invites/action-tokens';
import { loadNewDateModel, loadOfferModel } from '@/features/invites/manage-model';
import { VALIDATION_MESSAGE } from '@/features/requests/messages';
import { offerAnswer } from '@/features/requests/offer-answer';
import { ProposeBody, proposeTimes } from '@/features/requests/propose';
import { isHoneypotFilled } from '@/lib/honeypot';
import { jsonError, sameOrigin, tokenNoStore } from '@/lib/http';
import { limitByIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return tokenNoStore(jsonError(403, 'bad_origin', ERRORS.generic));
  const limited = await limitByIp(req, 'offerTake');
  if (limited) return tokenNoStore(limited);
  const parsed = ProposeBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return tokenNoStore(jsonError(400, 'invalid', ERRORS.generic));
  const res = await proposeTimes(parsed.data, isHoneypotFilled(parsed.data.hp));
  if (res === 'spent') {
    // The current state, from the page the link belongs to (a tampered token is a 404).
    const t = await findToken(parsed.data.token);
    const token = parsed.data.token;
    return offerAnswer(
      t?.purpose === 'pick_new_date' ? await loadNewDateModel(token) : await loadOfferModel(token),
    );
  }
  if (res.ok) return tokenNoStore(NextResponse.json({ ok: true, status: 'requested' }));
  if (res.status === 400 || res.status === 404)
    return tokenNoStore(jsonError(res.status, res.reason, ERRORS.generic));
  if (res.reason === 'not_changeable') return tokenNoStore(jsonError(409, res.reason, ERRORS.generic));
  return tokenNoStore(jsonError(409, res.reason, VALIDATION_MESSAGE[res.reason]));
}
