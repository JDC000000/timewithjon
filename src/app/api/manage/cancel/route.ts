// src/app/api/manage/cancel/route.ts — T2.7.04 POST: the guest cancels from S17. The manage token rides in the
// x-twj-manage header (never the body or the URL), the Origin must be ours, and it's rate limited per IP.
// Idempotent: a second Cancel answers ok with already=true ("Already cancelled. No guilt.").
import { NextResponse, type NextRequest } from 'next/server';
import { ALREADY, ERRORS } from '@/content';
import { requireManage } from '@/features/invites/require';
import { cancelByGuest } from '@/features/requests/guest-cancel';
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
  const res = await cancelByGuest(gate.requestId);
  if (res.ok)
    return tokenNoStore(NextResponse.json({ ok: true, already: res.already, message: ALREADY.cancelled }));
  if (res.status === 404) return tokenNoStore(jsonError(404, res.reason, ERRORS.generic));
  return tokenNoStore(jsonError(409, res.reason, ERRORS.generic));
}
