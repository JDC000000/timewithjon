// tests/fixtures/requests-db.ts — integration-test helpers: make requests through createRequestTx and put them in
// a state directly (the lock path has its own tests). Every id made is remembered so afterAll can remove it.
import { randomUUID } from 'node:crypto';
import { q, withTx } from '@/lib/db';
import { createRequestTx } from '@/features/requests/create';
import { RequestBody } from '@/features/requests/schema';

export const made: string[] = [];

export async function generalInviteId(): Promise<string> {
  return (await q<{ id: string }>(`select id from invite where kind = 'general' and revoked_at is null`))[0]!
    .id;
}

export const slotId = async (date: string, w: 'lunch' | 'evening') =>
  (await q<{ id: string }>(`select id from slot where date = $1 and window_kind = $2`, [date, w]))[0]!.id;

export async function newRequest(
  over: { name?: string; slotIds?: string[]; standbyWeek?: string; spam?: boolean; dish?: string } = {},
): Promise<string> {
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish: over.dish ?? 'the-long-lunch',
    name: over.name ?? 'Dave Guest',
    email: `dave+${randomUUID().slice(0, 8)}@example.com`,
    crew: 3,
    slotIds: over.slotIds ?? [],
    standbyWeek: over.standbyWeek,
  });
  const inviteId = await generalInviteId();
  const { requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId,
      isTest: true,
      spam: over.spam ?? false,
      mode: 'slots',
      status: over.standbyWeek ? 'standby' : 'requested',
      countsToward: 'weekly_cap',
      bigCrew: false,
      dishName: 'The Long Lunch',
    }),
  );
  made.push(requestId);
  return requestId;
}

/** Locks a request onto a slot, or onto an explicit range (dates mode), without the lock path. */
export async function lockDirect(
  id: string,
  to: { slotId: string } | { startsAt: Date; endsAt: Date; countsToward?: string },
): Promise<void> {
  if ('slotId' in to) {
    await q(
      `update request r set status = 'locked', locked_slot_id = s.id, locked_starts_at = s.starts_at,
              locked_ends_at = s.ends_at
         from slot s where s.id = $2 and r.id = $1`,
      [id, to.slotId],
    );
  } else {
    await q(
      `update request set status = 'locked', locked_starts_at = $2, locked_ends_at = $3,
              counts_toward = $4::counts_toward where id = $1`,
      [id, to.startsAt, to.endsAt, to.countsToward ?? 'big_day'],
    );
  }
}

/** A joined guest (T2.10): locked with no range of its own, following its host. */
export async function joinDirect(id: string, hostId: string): Promise<void> {
  await q(`update request set status = 'locked', joined_to_request_id = $2 where id = $1`, [id, hostId]);
}

/** afterAll: every request made here goes for good (HYG: a cancelled one would still sit in admin's capped tabs). */
export async function cancelMade(): Promise<void> {
  await removeRequests(made);
}

/**
 * Removes test requests for good, so repeated runs on one DB don't pile cancelled rows into admin-inbox's capped
 * Cancelled tab. Their email_log rows go first (on delete email_log.request_id turns NULL, and two rows sharing a
 * template + event key would then collide); joined links are cut first (the self-reference has no ON DELETE).
 */
export async function removeRequests(ids: string[]): Promise<void> {
  await q(
    `update request set status = 'cancelled', cancelled_at = now(), awaiting_jon_since = null,
                        joined_to_request_id = null
      where id = any($1::uuid[]) or joined_to_request_id = any($1::uuid[])`,
    [ids],
  );
  await q(`delete from email_log where request_id = any($1::uuid[])`, [ids]);
  // Their outbox rows too (HYG/F4): on delete they'd stay behind, open, with a NULL request_id.
  await q(`delete from outbox where request_id = any($1::uuid[])`, [ids]);
  await q(`delete from request where id = any($1::uuid[])`, [ids]);
}
