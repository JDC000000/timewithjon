// src/features/email/link-vars.ts — action-token links are minted when an email is SENT, never stored raw
// (TSD §6 action_token: the raw token exists only inside the email; C5: every guest email carries a FRESH link).
// email_log.vars holds a LINK SPEC ({ link: 'manage', requestId }); deliverEmail calls resolveLinkVars() just
// before rendering. The token is DETERMINISTIC per email row and link kind (emailLinkToken, the pr40-review H1
// ruling): the first try stores its hash (and the email_log row it belongs to), a retry finds it and renders the
// byte-identical body under the same provider idempotency key. Nothing is revoked on a retry; links end only on
// business events (expiry, and later a cancel or supersede rule).
// Link kinds are registered below: lane L1 appends 'take' and 'pick' (take_offer / pick_new_date).
import 'server-only';
import type { Pool } from 'pg';
import {
  emailLinkToken,
  issueManageToken,
  issueToken,
  singleUseExpiry,
  tokenUrl,
} from '@/features/invites/action-tokens';
import { inviteLink } from '@/features/admin/invites';
import { pool } from '@/lib/db';
import { MANAGE_ANOTHER_ANCHOR } from '@/ui/routes';

export interface LinkSpec {
  link: string;
  requestId?: string;
  offerId?: string;
  /** manage only: open a part of the page on load (E8 → the pitch form, EML-05). */
  anchor?: typeof MANAGE_ANCHOR;
}
/** The manage page's "Ask for another time" fragment (EML-05). */
export const MANAGE_ANCHOR = MANAGE_ANOTHER_ANCHOR;
export type EmailVar = string | number | LinkSpec;

/** A queued email names a link kind nobody registered: it fails closed (marked failed, reported, never sent). */
export class UnknownLinkKindError extends Error {
  override name = 'UnknownLinkKindError';
}

/** The offer behind a take/pick link was taken, released or has expired before the email went out (pr49-review
 * L-3): a dead link is never sent. It keeps the UnknownLinkKindError name on purpose: send.ts matches its terminal
 * render errors BY NAME, so the row is failed for good (attempts maxed, never retried or resent; N49-1). */
export class OfferLinkGoneError extends UnknownLinkKindError {}

type Mint = (db: Pool, spec: LinkSpec, ctx: { emailLogId: string; now: Date }) => Promise<string>;

/** T2.4 (lane L1): a single-use take_offer / pick_new_date token for one offer; it expires with the offer.
 *  Deterministic per email row + kind (emailLinkToken), so a retried send renders the byte-identical link. */
function offerMinter(purpose: 'take_offer' | 'pick_new_date', page: 'offer' | 'new-date'): Mint {
  return async (c, spec, { emailLogId, now }) => {
    const { rows } = spec.offerId
      ? await c.query<{ request_id: string; expires_at: Date | null; live: boolean }>(
          `select request_id, expires_at,
                  taken_at is null and released_at is null and (expires_at is null or expires_at > $2) as live
             from offer where id = $1`,
          [spec.offerId, now],
        )
      : { rows: [] };
    if (!rows[0]) throw new UnknownLinkKindError(spec.link);
    if (!rows[0].live) throw new OfferLinkGoneError(spec.link);
    const raw = await issueToken(c, {
      raw: emailLinkToken(emailLogId, spec.link),
      purpose,
      requestId: rows[0].request_id,
      offerId: spec.offerId,
      expiresAt: singleUseExpiry(rows[0].expires_at, now),
      emailLogId,
    });
    return tokenUrl(page, raw);
  };
}

const MINTERS: Record<string, Mint> = {
  manage: async (db, spec, { emailLogId, now }) => {
    if (!spec.requestId) throw new UnknownLinkKindError('manage');
    const raw = emailLinkToken(emailLogId, 'manage');
    const url = tokenUrl('manage', await issueManageToken(db, spec.requestId, now, emailLogId, raw));
    return spec.anchor === MANAGE_ANCHOR ? `${url}#${MANAGE_ANCHOR}` : url;
  },
  take: offerMinter('take_offer', 'offer'),
  pick: offerMinter('pick_new_date', 'new-date'),
  // T2.4.05 E9 "Pick anything else": the guest's own invite link, built at send time like every other link. A
  // revoked invite is never sent (pr51-review L1): the email fails closed.
  menu: async (db, spec) => {
    const { rows } = spec.requestId
      ? await db.query<{ name_slug: string; token_secret: string }>(
          `select i.name_slug, i.token_secret from request r join invite i on i.id = r.invite_id
            where r.id = $1 and i.revoked_at is null`,
          [spec.requestId],
        )
      : { rows: [] };
    if (!rows[0]) throw new UnknownLinkKindError(spec.link);
    return inviteLink(rows[0]);
  },
};

export const manageLink = (requestId: string, anchor?: typeof MANAGE_ANCHOR): LinkSpec =>
  anchor ? { link: 'manage', requestId, anchor } : { link: 'manage', requestId };
export const takeLink = (offerId: string): LinkSpec => ({ link: 'take', offerId });
export const pickLink = (offerId: string): LinkSpec => ({ link: 'pick', offerId });
export const menuLink = (requestId: string): LinkSpec => ({ link: 'menu', requestId });

export function isLinkSpec(v: unknown): v is LinkSpec {
  return typeof v === 'object' && v !== null && typeof (v as { link?: unknown }).link === 'string';
}

/** Link specs → fresh URLs (in memory only). Vars without a link spec pass through with no database work. */
export async function resolveLinkVars(
  emailLogId: string,
  vars: Record<string, unknown>,
  now = new Date(),
): Promise<Record<string, string | number>> {
  const out: Record<string, string | number> = {};
  const links = Object.entries(vars).filter(([, v]) => isLinkSpec(v)) as [string, LinkSpec][];
  for (const [k, v] of Object.entries(vars)) if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  if (links.length === 0) return out;
  // Own keys only (pr40-review M2): 'toString', 'constructor' and friends are unknown kinds, not minters.
  for (const [, spec] of links)
    if (!Object.hasOwn(MINTERS, spec.link)) throw new UnknownLinkKindError(spec.link);
  for (const [k, spec] of links) out[k] = await MINTERS[spec.link]!(pool(), spec, { emailLogId, now });
  return out;
}
