// src/features/requests/offer-answer.ts — T2.4 the JSON answer of the S18 POSTs (take an offer, propose new
// times), from L3's read-only page models: a tampered token 404, a stale one the "text me" line, otherwise the
// request's current state and its guest line ("You're locked in for Thu May 13.", AC1; null when the guest's own
// times are with Jon: the page then shows what was sent). Never cached.
import 'server-only';
import { NextResponse } from 'next/server';
import { ERRORS } from '@/content';
import { jsonError, tokenNoStore } from '@/lib/http';

/** The shape of L3's S18 page models (manage-model.ts is imported only by guest routes: sealed-plan test). */
type PageModel =
  | { kind: 'not_found' }
  | { kind: 'expired'; message: string }
  | { kind: 'current'; status: string; message: string | null }
  | { kind: 'offer' | 'new_date'; status: string };

export function offerAnswer(model: PageModel): Response {
  if (model.kind === 'not_found') return tokenNoStore(jsonError(404, 'not_found', ERRORS.generic));
  if (model.kind === 'expired') return tokenNoStore(jsonError(410, 'expired', model.message));
  if (model.kind === 'current') {
    return tokenNoStore(NextResponse.json({ ok: true, status: model.status, message: model.message }));
  }
  // The token is still live (nothing was spent): the page keeps offering.
  return tokenNoStore(NextResponse.json({ ok: true, status: model.status, message: null }));
}
