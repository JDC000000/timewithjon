// src/lib/requests/create.ts — T1.7 one transaction: guest (never updated), request, choices, audit. Idempotent on client_key.
import 'server-only';
import type { PoolClient } from 'pg';
import { getEnv } from '@/config/env';
import { countEvent } from '@/features/analytics/count';
import { withTx } from '@/lib/db';
import type { CountsToward } from '@/features/availability/types';
import { jonEmail, queueEmail } from '@/features/email/send';
import { intakeEmails, requestedTimeLines } from './intake-emails';
import type { RequestBody } from './schema';

/** A client_key replayed from a different invite (review T4.2.00 L3). The route answers 409. */
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
}

export async function createRequestTx(
  c: PoolClient,
  a: CreateArgs,
): Promise<{ requestId: string; created: boolean }> {
  const b = a.body;
  const replay = async () => {
    const { rows } = await c.query<{ id: string; invite_id: string }>(
      `select id, invite_id from request where client_key = $1`,
      [b.clientKey],
    );
    if (!rows[0]) return null;
    if (rows[0].invite_id !== a.inviteId) throw new ReplayConflictError();
    return { requestId: rows[0].id, created: false };
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
  const ins = await c.query<{ id: string }>(
    `insert into request (is_test, client_key, guest_id, invite_id, contact_name, contact_email, contact_phone, dish, mode, status,
                          spam_suspect, crew_size, big_crew, guest_time_zone, note, date_prefs, overnight, pitch_idea,
                          surprise_need_to_know, surprise_plan_sealed, standby_week, counts_toward, overnight_night, awaiting_jon_since)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23, case when $11 then null else now() end)
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
    const starts =
      a.mode === 'slots'
        ? (
            await c.query<{ starts_at: Date }>(`select starts_at from slot where id = any($1::uuid[])`, [
              b.slotIds,
            ])
          ).rows.map((r) => r.starts_at)
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
      standbyWeek: b.standbyWeek ?? null,
      requestedTimes: requestedTimeLines(starts, a.mode === 'dates' ? b.dates : [], b.guestTimeZone ?? null),
      jonEmail: jonEmail(),
      siteUrl: getEnv().NEXT_PUBLIC_SITE_URL,
    });
    for (const e of emails) await queueEmail(c, e);
  }
  if (!a.spam) await countEvent('request_sent', c); // T3.11: a honeypot hit is a bot, not a request
  return { requestId, created: true };
}

export function createRequest(a: CreateArgs) {
  return withTx((c) => createRequestTx(c, a));
}
