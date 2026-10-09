// src/lib/requests/create.ts — T1.7 one transaction: guest (never updated), request, choices, audit. Idempotent on client_key.
import 'server-only';
import type { PoolClient } from 'pg';
import { getEnv } from '@/config/env';
import { countEvent } from '@/features/analytics/count';
import { q, withTx } from '@/lib/db';
import { payloadHash } from '@/lib/payload-hash';
import { hit } from '@/lib/ratelimit';
import type { CountsToward } from '@/features/availability/types';
import { jonEmail, queueEmail } from '@/features/email/send';
import { intakeEmails, requestedTimeLines } from './intake-emails';
import type { RequestBody } from './schema';

/**
 * A client_key replayed from a different invite (review T4.2.00 L3), or with a different body (ENG-01: an edited
 * form re-sent under the key of a request already saved must never be answered as if the edits went). 409.
 */
export class ReplayConflictError extends Error {
  override name = 'ReplayConflictError';
}

export interface CreateArgs {
  body: RequestBody;
  inviteId: string;
  isTest: boolean;
  spam: boolean;
  mode: 'slots' | 'dates';
  status: 'requested' | 'standby';
  countsToward: CountsToward;
  bigCrew: boolean;
  dishName: string;
  /** The general invite: guest intake emails count toward its daily cap (requestSendInvite). */
  capGuestEmails?: boolean;
}

/** What the transaction is told: whether the guest's intake email may go (the cap was taken before it, CR-02). */
type TxArgs = Omit<CreateArgs, 'capGuestEmails'> & { sendGuestEmails?: boolean };

/** ENG-01: the body a client key stands for (the key itself and the one-use Turnstile token aside). */
export function requestPayloadHash(b: RequestBody): string {
  return payloadHash({ ...b, clientKey: undefined, turnstileToken: undefined }); // undefined keys drop out
}

type StoredKey = { id: string; invite_id: string; client_payload_hash: string | null };

/** The request this key already made, or null; a conflict (another invite, another body) throws. */
function replayed(row: StoredKey | undefined, b: RequestBody, inviteId: string): string | null {
  if (!row) return null;
  if (row.invite_id !== inviteId) throw new ReplayConflictError();
  // A row from before the hash was stored replays as before.
  if (row.client_payload_hash !== null && row.client_payload_hash !== requestPayloadHash(b))
    throw new ReplayConflictError();
  return row.id;
}

const STORED_KEY = `select id, invite_id, client_payload_hash from request where client_key = $1`;

/**
 * ENG-03: the replay is looked up BEFORE the request is validated against the engine. A retry after a lost answer
 * must get its saved request back even if the time has since gone or the week has reopened.
 */
export async function findReplay(b: RequestBody, inviteId: string): Promise<string | null> {
  return replayed((await q<StoredKey>(STORED_KEY, [b.clientKey]))[0], b, inviteId);
}

/** QA4b M1: how long the same request again (under a new key) counts as the one already sent. */
export const DUPLICATE_WINDOW_MINUTES = 10;

/**
 * QA4b M1: Back after Send shows an empty form, and Send again (a new key) with the same dish, picks and details
 * made a second request. The same body from the same invite within DUPLICATE_WINDOW_MINUTES (and not cancelled
 * since) is the request already sent: the guest gets it back, as a replay. Any difference (other times, another
 * note, another email) is a new request.
 */
export async function findRecentDuplicate(b: RequestBody, inviteId: string): Promise<string | null> {
  const rows = await q<{ id: string }>(
    `select id from request
      where invite_id = $1 and client_payload_hash = $2 and status <> 'cancelled'
        and created_at > now() - make_interval(mins => $3)
      order by created_at desc limit 1`,
    [inviteId, requestPayloadHash(b), DUPLICATE_WINDOW_MINUTES],
  );
  return rows[0]?.id ?? null;
}

/** The intake emails addressed to the guest (to whatever address the form carried). */
const GUEST_INTAKE = new Set(['E1', 'E6']);

export async function createRequestTx(
  c: PoolClient,
  a: TxArgs,
): Promise<{ requestId: string; created: boolean }> {
  const b = a.body;
  const replay = async () => {
    const id = replayed((await c.query<StoredKey>(STORED_KEY, [b.clientKey])).rows[0], b, a.inviteId);
    return id ? { requestId: id, created: false } : null;
  };
  const existing = await replay();
  if (existing) return existing;
  // Find-or-create by email. NEVER update an existing guest from a public POST (T1.7 AC7).
  await c.query(`insert into guest (email, first_name_seen) values ($1, $2) on conflict (email) do nothing`, [
    b.email,
    b.name,
  ]);
  const {
    rows: [guest],
  } = await c.query<{ id: string }>(`select id from guest where email = $1`, [b.email]);
  // No wait on Jon for a bot (AD-9), nor for a guest's own stand-by (ENG-12): it waits on a freed window, not on
  // Jon, as when Jon moves a request to stand-by (standby.ts). So no E3 "still waiting" nudge either.
  const ins = await c.query<{ id: string }>(
    `insert into request (is_test, client_key, guest_id, invite_id, contact_name, contact_email, contact_phone, dish, mode, status,
                          spam_suspect, crew_size, big_crew, guest_time_zone, note, date_prefs, overnight, pitch_idea,
                          surprise_need_to_know, surprise_plan_sealed, standby_week, counts_toward, overnight_night, awaiting_jon_since,
                          client_payload_hash)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
             case when $11 or $10::request_status = 'standby' then null else now() end,
             $24)
     on conflict (client_key) do nothing returning id`,
    [
      a.isTest,
      b.clientKey,
      guest!.id,
      a.inviteId,
      b.name,
      b.email,
      b.phone || null,
      b.dish,
      a.mode,
      a.status,
      a.spam,
      b.crew,
      a.bigCrew,
      b.guestTimeZone ?? null,
      b.note ?? null,
      a.mode === 'dates' ? JSON.stringify({ dates: b.dates, window_text: b.windowText ?? null }) : null,
      b.overnight,
      b.pitchIdea ?? null,
      b.surpriseNeedToKnow ?? null,
      b.surprisePlan ?? null,
      b.standbyWeek ?? null,
      a.countsToward,
      (b.overnight && b.overnightNight) || null,
      requestPayloadHash(b),
    ],
  );
  if (!ins.rows[0]) return (await replay())!; // lost a double-tap race: same result
  const requestId = ins.rows[0].id;
  for (const slotId of a.mode === 'slots' ? b.slotIds : []) {
    await c.query(`insert into request_slot_choice (request_id, slot_id) values ($1, $2)`, [
      requestId,
      slotId,
    ]);
  }
  const {
    rows: [audit],
  } = await c.query<{ id: string }>(
    `insert into audit_log (actor, action, request_id, detail) values ('guest', 'request_created', $1, $2) returning id`,
    [requestId, JSON.stringify({ to_status: a.status })],
  );
  // L-3: the emails are queued as 'pending' rows in THIS transaction and sent after commit (AD-9: never for spam).
  if (!a.spam) {
    const slots =
      a.mode === 'slots'
        ? (
            await c.query<{ startsAt: Date; endsAt: Date }>(
              `select starts_at as "startsAt", ends_at as "endsAt" from slot where id = any($1::uuid[])`,
              [b.slotIds],
            )
          ).rows
        : [];
    const emails = intakeEmails({
      requestId,
      auditId: audit!.id,
      status: a.status,
      dishName: a.dishName,
      guestEmail: b.email,
      guestName: b.name,
      crew: b.crew,
      bigCrew: a.bigCrew,
      choiceCount: a.mode === 'slots' ? b.slotIds.length : b.dates.length,
      choiceKind: a.mode === 'slots' ? 'times' : 'dates',
      overnight: b.overnight,
      standbyWeek: b.standbyWeek ?? null,
      requestedTimes: requestedTimeLines(slots, a.mode === 'dates' ? b.dates : [], b.guestTimeZone ?? null),
      jonEmail: jonEmail(),
      siteUrl: getEnv().NEXT_PUBLIC_SITE_URL,
    });
    // Over the general invite's daily cap: the request stands and Jon's E2 goes, the guest's email does not.
    const guestOk = a.sendGuestEmails ?? true;
    for (const e of emails) if (guestOk || !GUEST_INTAKE.has(e.template)) await queueEmail(c, e);
  }
  if (!a.spam) await countEvent('request_sent', c); // T3.11: a honeypot hit is a bot, not a request
  return { requestId, created: true };
}

/**
 * CR-02: the general invite's cap is counted BEFORE the transaction. hit() goes through the pool; taken inside the
 * transaction it needed a second connection while this one was held, so a few concurrent general-link Sends used
 * up the pool (3), waited out its 5 s timeout, and the limiter failed open (the cap went uncounted). A bot (spam)
 * never counts. A replayed client_key counts once more; it queues no email, so that only makes the cap stricter.
 */
export async function createRequest({ capGuestEmails, ...a }: CreateArgs) {
  const sendGuestEmails = a.spam || !capGuestEmails || (await hit('requestSendInvite', a.inviteId));
  return withTx((c) => createRequestTx(c, { ...a, sendGuestEmails }));
}
