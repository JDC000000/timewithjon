// src/features/requests/joined-cascade.ts — T2.10.03 the §6 "Joined requests" rules 3 and 4: what happens to the
// guests joined to a host when the host's booking changes. Their attendee rows are derived from the locked joined
// rows by the calendar outbox, so the host's own calendar row (patch or delete) already moves or drops them; this
// module writes their state, audit rows and emails, inside the caller's transaction.
//   rule 3, Change time: removed 2026-09-29 (a guest who needs another time emails Jon).
//   rule 3, Weather call / block or away (lanes L1 / L2): call cascadeToJoined with toStatus 'needs_new_time' and
//     their E10 / E5b, BEFORE the host's range is cleared.
//   rule 4, the host left from their manage page: hostLeft() below (E5j).
import 'server-only';
import type { PoolClient } from 'pg';
import type { TemplateId } from '@/content/emails';
import { dishBySlug } from '@/content/menu-helpers';
import type { EmailVar } from '@/features/email/link-vars';
import { queueEmail } from '@/features/email/send';
import { extendManageTokens, reopenManageTokens } from '@/features/invites/action-tokens';
import { queuedId } from './side-effects';

export interface JoinedGuest {
  id: string;
  contact_email: string;
  dish: string;
  guest_time_zone: string | null;
}

export interface CascadeOptions {
  template: TemplateId;
  /** The host's audit row for this change: email_log is unique on template + request + event key (sent once). */
  eventKey: string;
  now: Date;
  vars: (j: JoinedGuest) => Record<string, EmailVar>;
  /**
   * Omitted: they ride along with the host. 'needs_new_time': they are unhooked from the live booking and wait on
   * Jon (awaiting_jon_since), still naming the old host, with a copy of its range for Promote to host (rule 4).
   */
  toStatus?: { status: 'needs_new_time'; auditAction: string };
  /** Their manage links last to this end + 7 days (§6), as the host's do. */
  extendLinksTo?: Date;
}

export const dishName = (slug: string): string => dishBySlug(slug)?.name ?? slug;

/** A 'needs_new_time' cascade ran after the caller had already cleared the host's range: nothing left to copy. */
export class HostRangeClearedError extends Error {
  override name = 'HostRangeClearedError';
}

/**
 * Every guest joined to the live host booking (status 'locked') gets the host's change; a second cascade on the
 * same host finds none and is a no-op. Returns the queued email_log ids.
 * Contract: the caller holds the host row lock (FOR UPDATE) in this transaction, and a 'needs_new_time' cascade
 * runs BEFORE the caller clears the host's range (it copies that range onto the joined rows for Promote to host;
 * it throws HostRangeClearedError otherwise, so the transaction rolls back rather than losing the time).
 */
export async function cascadeToJoined(c: PoolClient, hostId: string, o: CascadeOptions): Promise<string[]> {
  const cols = `j.id, j.contact_email::text as contact_email, j.dish, j.guest_time_zone`;
  // The copy of the host's range (and its cap kind) is read from the host row in the same statement, so a caller
  // that changes the host afterwards (Ask for another time clears the range and resets the kind) still leaves the
  // booking as it was on the joined rows.
  const { rows } = o.toStatus
    ? await c.query<JoinedGuest & { copied?: boolean }>(
        `update request j
            set status = 'needs_new_time', awaiting_jon_since = $2, locked_starts_at = h.locked_starts_at,
                locked_ends_at = h.locked_ends_at, locked_where = h.locked_where, locked_slot_id = h.locked_slot_id,
                counts_toward = h.counts_toward
           from request h
          where h.id = $1 and j.joined_to_request_id = h.id and j.status = 'locked'
          returning ${cols}, j.locked_starts_at is not null and j.locked_ends_at is not null as copied`,
        [hostId, o.now],
      )
    : await c.query<JoinedGuest>(
        `select ${cols} from request j where j.joined_to_request_id = $1 and j.status = 'locked'
          order by j.created_at, j.id for update`,
        [hostId],
      );
  if (rows.some((j) => 'copied' in j && j.copied === false)) {
    throw new HostRangeClearedError('cascadeToJoined: the host range was cleared before the cascade');
  }
  const emailIds: string[] = [];
  for (const j of rows) {
    if (o.toStatus) {
      await c.query(
        `insert into audit_log (actor, action, request_id, detail) values ('system', $2, $1, $3)`,
        [
          j.id,
          o.toStatus.auditAction,
          JSON.stringify({ from_status: 'locked', to_status: o.toStatus.status }),
        ],
      );
    }
    if (o.extendLinksTo) await extendManageTokens(c, j.id, o.extendLinksTo);
    const queued = await queueEmail(c, {
      template: o.template,
      to: j.contact_email,
      requestId: j.id,
      eventKey: o.eventKey,
      vars: o.vars(j),
    });
    emailIds.push(...queuedId(queued));
  }
  return emailIds;
}

/**
 * Rule 4: the host left from their manage page (a cancel, or Ask for another time). Each guest joined to it goes
 * to needs_new_time with awaiting_jon_since set (so Jon sees them in Needs a reply and can Promote to host), and
 * gets E5j, once: its event key is the host's audit row. Nobody else is cancelled. joined_to_request_id is kept:
 * it names the old host, and the copy of its range is what Promote to host locks (T2.10.04).
 */
export async function hostLeft(
  c: PoolClient,
  hostId: string,
  now: Date,
  hostAuditId: string,
): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>(
    `select j.id from request j where j.joined_to_request_id = $1 and j.status = 'locked'`,
    [hostId],
  );
  const emailIds = await cascadeToJoined(c, hostId, {
    template: 'E5j',
    eventKey: hostAuditId,
    now,
    toStatus: { status: 'needs_new_time', auditAction: 'host_left' },
    vars: (j) => ({ dish: dishName(j.dish) }),
  });
  // Their manage links ran to the host's end + 7 days; now waiting on Jon, they get the unlocked lifetime (§6).
  // After the cascade, so the request rows are locked before their tokens (the request → action_token order).
  await reopenManageTokens(
    c,
    rows.map((j) => j.id),
    now,
  );
  return emailIds;
}
