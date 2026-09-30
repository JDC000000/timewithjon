// src/lib/invites/require.ts — gate for the picker/form/request APIs (T1.4 AC4). Manage-token grant added in T2.7.
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { ERRORS } from '@/content';
import { q } from '@/lib/db';
import { MANAGE_HEADER, manageGrant } from './action-tokens';
import { getInviteSession, INVITE_COOKIE } from './session';
import { findInviteById, type Invite } from './repo';

export { MANAGE_HEADER };

export async function requireInvite(): Promise<{ invite: Invite } | { response: NextResponse }> {
  const s = await getInviteSession();
  if (s.state === 'valid') return { invite: s.invite };
  const response = NextResponse.json(
    { ok: false, code: 'invite_required', message: s.state === 'stale' ? ERRORS.stale : ERRORS.noInvite },
    { status: 403 },
  );
  if (s.state === 'stale') response.cookies.delete(INVITE_COOKIE);
  return { response };
}

export type Gate =
  { invite: Invite; manageRequestId: string | null; manageDish: string | null } | { response: NextResponse };

/**
 * T2.7.02 / C2: an `x-twj-manage` header carrying a valid manage token grants access FOR THAT TOKEN'S REQUEST
 * ONLY (manageRequestId), through the invite the request was made on, even if that invite has since been
 * rotated or revoked (T2.7 AC6). A header that is present but not a valid manage token never falls back to the
 * cookie: the caller asked for the manage grant and doesn't get it. No header: the usual invite cookie.
 */
export async function requireInviteOrManage(req: NextRequest): Promise<Gate> {
  const raw = req.headers.get(MANAGE_HEADER);
  if (raw === null) {
    const gate = await requireInvite();
    return 'response' in gate ? gate : { invite: gate.invite, manageRequestId: null, manageDish: null };
  }
  const requestId = await manageGrant(raw);
  const [r] = requestId
    ? await q<{ invite_id: string; dish: string }>(`select invite_id, dish from request where id = $1`, [
        requestId,
      ])
    : [];
  const invite = r ? await findInviteById(r.invite_id) : null;
  if (!requestId || !r || !invite) return { response: staleResponse() };
  return { invite, manageRequestId: requestId, manageDish: r.dish };
}

/** Only the manage grant (the manage-page POSTs): the request id, or a 403 with the "text me" line. */
export async function requireManage(
  req: NextRequest,
): Promise<{ requestId: string } | { response: NextResponse }> {
  const requestId = await manageGrant(req.headers.get(MANAGE_HEADER));
  return requestId ? { requestId } : { response: staleResponse() };
}

function staleResponse(): NextResponse {
  return NextResponse.json({ ok: false, code: 'manage_link_stale', message: ERRORS.stale }, { status: 403 });
}
