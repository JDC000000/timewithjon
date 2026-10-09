// src/lib/invites/session.ts — reads the twj_invite cookie (C2). Server Components + route handlers.
import 'server-only';
import { cookies } from 'next/headers';
import { getEnv } from '@/config/env';
import { verifyCookie } from '@/features/invites/tokens';
import { findInviteById, type Invite } from './repo';

export const INVITE_COOKIE = 'twj_invite';
export const STALE_COOKIE = 'twj_stale';
/**
 * Set by /api/invite/resolve when a link replaced a session that named a DIFFERENT valid invite; holds the new invite's
 * id. While it names the current invite, the booking form shows no name or email from it: the guest types their own,
 * so a forwarded link can't quietly send their booking emails to the invite's owner.
 */
export const SWITCHED_COOKIE = 'twj_switched';
export const INVITE_TTL_SECONDS = 180 * 24 * 3600;

export type InviteSession =
  | {
      state: 'valid';
      invite: Invite;
      /** see SWITCHED_COOKIE (getInviteSession always sets it) */ switched?: boolean;
    }
  | { state: 'none' }
  | { state: 'stale' };

export async function getInviteSession(): Promise<InviteSession> {
  const jar = await cookies();
  const id = verifyCookie('invite', jar.get(INVITE_COOKIE)?.value, getEnv().SESSION_SIGNING_SECRET);
  if (!id) return jar.get(STALE_COOKIE) ? { state: 'stale' } : { state: 'none' };
  const invite = await findInviteById(id);
  if (!invite || invite.revoked_at) return { state: 'stale' }; // route handlers clear the cookie (requireInvite)
  const switched = verifyCookie('switch', jar.get(SWITCHED_COOKIE)?.value, getEnv().SESSION_SIGNING_SECRET);
  return { state: 'valid', invite, switched: switched === invite.id };
}
