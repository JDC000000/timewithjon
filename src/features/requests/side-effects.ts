// src/features/requests/side-effects.ts — shared by the guest's manage-page actions (T2.7): the outbox rows and
// email_log rows are written inside the transaction; after commit they run here, awaited (AD-1, L-3). A failure
// leaves the rows for the tick jobs (outbox-retry, email-retry); the state change itself stands.
import 'server-only';
import type { PoolClient } from 'pg';
import { getEnv } from '@/config/env';
import { processOutbox } from '@/features/calendar/outbox';
import { deliverEmail, type QueueResult } from '@/features/email/send';
import { q } from '@/lib/db';
import { report } from '@/lib/report';

export interface AfterCommit {
  outboxIds: string[];
  emailIds: string[];
}
export const noSideEffects = (): AfterCommit => ({ outboxIds: [], emailIds: [] });

export async function enqueueCalendar(
  c: PoolClient,
  kind: 'calendar_create' | 'calendar_patch' | 'calendar_delete',
  requestId: string,
  payload: { attendees?: true } = {},
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into outbox (kind, request_id, payload) values ($1, $2, $3) returning id`,
    [kind, requestId, JSON.stringify(payload)],
  );
  return rows[0]!.id;
}

/**
 * Row-lock order for every action on a joined guest (pr48-review F3): the HOST first, then the joined request, as
 * lock.ts, hostLeft and joined.ts take them. Call it before locking the request itself; it locks the request's
 * host, if it has one, and returns its id. A joined guest's cancel or detach then waits for a host change in flight
 * (and vice versa) instead of reading the host's status mid-change or deadlocking with it.
 */
export async function lockHostOf(c: PoolClient, requestId: string): Promise<string | null> {
  const { rows } = await c.query<{ host: string | null }>(
    `select r.joined_to_request_id as host from request r where r.id = $1`,
    [requestId],
  );
  const host = rows[0]?.host ?? null;
  if (host) await c.query(`select h.id from request h where h.id = $1 for update`, [host]);
  return host;
}

/**
 * A joined guest left the host's booking: patch the host's event, if it's live. Its attendees are derived, and
 * the row says so ({attendees: true}), so the gateway sends Google the new attendee list.
 */
export async function patchHostIfLocked(c: PoolClient, hostId: string): Promise<string | null> {
  // Locked (normally already by lockHostOf; this covers a host re-pointed between that read and the row lock).
  const { rows } = await c.query<{ status: string }>(
    `select r.status from request r where r.id = $1 for update`,
    [hostId],
  );
  return rows[0]?.status === 'locked'
    ? enqueueCalendar(c, 'calendar_patch', hostId, { attendees: true })
    : null;
}

export function queuedId(r: QueueResult): string[] {
  return typeof r === 'object' ? [r.queued] : [];
}

export function adminLink(requestId: string): string {
  return `${getEnv().NEXT_PUBLIC_SITE_URL}/admin/requests/${requestId}`;
}

/**
 * ENG-16: a request's calendar rows run one at a time, oldest first. When another action committed a row for the
 * same request while ours was in flight (Jon's lock racing the guest's cancel: the cancel's delete waits for the
 * lock's create), that row's own inline run was skipped. Run it now, after ours, instead of leaving it to the next
 * tick, so the event the create made is deleted at once. Only rows never tried (attempts = 0); a row that is
 * still blocked answers 'skipped' and stays the tick's.
 */
async function runWaitingRows(ownIds: string[]): Promise<void> {
  const waiting = await q<{ id: string }>(
    `select o.id from outbox o
      where o.request_id in (select request_id from outbox where id = any($1::uuid[]) and request_id is not null)
        and o.id <> all($1::uuid[]) and o.done_at is null and o.attempts = 0
        and o.kind in ('calendar_create', 'calendar_patch', 'calendar_delete')
      order by o.created_at, o.id`,
    [ownIds],
  );
  for (const { id } of waiting) await processOutbox(id, { inline: true });
}

export async function runAfterCommit(a: AfterCommit, area: string): Promise<void> {
  // Calendar rows in order (a request's rows run oldest first anyway); emails alongside, so a slow Google call
  // doesn't hold them up.
  const calendar = async () => {
    for (const id of a.outboxIds) await processOutbox(id, { inline: true });
    if (a.outboxIds.length) await runWaitingRows(a.outboxIds);
  };
  const results = await Promise.allSettled([
    calendar(),
    ...a.emailIds.map((id) => deliverEmail(id, { inline: true })),
  ]);
  for (const r of results) if (r.status === 'rejected') report(r.reason, { area, step: 'after_commit' });
}
