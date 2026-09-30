// src/app/api/manage/another-time/route.ts — T2.7.05 POST: "Ask for another time" ON SUBMIT from S17's picker or
// date form. The manage token (x-twj-manage header) names the request; the body carries only the new choices
// (a request_id in the body is refused: strict schema). The Origin check, then the per-IP limit (manageAction), before anything else.
import { NextResponse, type NextRequest } from 'next/server';
import { ERRORS } from '@/content';
import { requireManage } from '@/features/invites/require';
import { VALIDATION_MESSAGE } from '@/features/requests/messages';
import { RerequestBody, rerequest } from '@/features/requests/rerequest';
import { isHoneypotFilled } from '@/lib/honeypot';
import { jsonError, sameOrigin, tokenNoStore } from '@/lib/http';
import { limitByIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return tokenNoStore(jsonError(403, 'bad_origin', ERRORS.generic));
  const limited = await limitByIp(req, 'manageAction'); // T3.8.02: first, before any token or body work
  if (limited) return tokenNoStore(limited);
  const gate = await requireManage(req);
  if ('response' in gate) return tokenNoStore(gate.response);
  const parsed = RerequestBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return tokenNoStore(jsonError(400, 'invalid', ERRORS.generic));
  const { hp, clientKey, ...choices } = parsed.data;
  // AD-9: a filled honeypot is stored as spam_suspect (no E16), never refused: the guest gets the same answer.
  const res = await rerequest(gate.requestId, choices, new Date(), { clientKey, spam: isHoneypotFilled(hp) });
  if (res.ok) return tokenNoStore(NextResponse.json({ ok: true }));
  if (res.status === 404) return tokenNoStore(jsonError(404, res.reason, ERRORS.generic));
  if (res.reason === 'not_changeable') return tokenNoStore(jsonError(409, res.reason, ERRORS.generic));
  return tokenNoStore(jsonError(409, res.reason, VALIDATION_MESSAGE[res.reason]));
}
