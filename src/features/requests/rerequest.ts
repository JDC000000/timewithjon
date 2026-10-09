// src/features/requests/rerequest.ts — T2.7.05 "Ask for another time" ON SUBMIT (never when the page opens):
// the SAME row goes back to `requested` with its choices replaced, the event is deleted if it was locked, live
// offers are released, and E16 goes to Jon (§6: `locked` → `requested`, and `requested`/`needs_new_time`/
// `standby` → `requested`). A joined guest detaches (rule 5): joined_to_request_id is cleared and the host's event
// is patched to drop them. The host leaving works as a cancel does for its joined guests (rule 4). A request Jon
// cancelled for the guest (2026-10-05, not closed in person) can come back the same way: `cancelled` →
// `requested`; its event and joined-guest changes were already made by the cancel.
// Lane L1's T2.4.08 (the guest proposes new times from an offer or weather-call page) reuses checkRerequest()
// (before its transaction: it may read Google free/busy, L-3) and rerequestTx() (inside it).
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { dishBySlug, dishInSentence } from '@/content/menu-helpers';
import { getBusy } from '@/features/availability/busy';
import { engineInput, loadEngineData, withoutOwnBooking } from '@/features/availability/load';
import { openWindows } from '@/features/availability/openWindows';
import { queueIcsEmail } from '@/features/calendar/ics-email';
import { jonEmail, queueEmail } from '@/features/email/send';
import { reopenManageTokens } from '@/features/invites/action-tokens';
import { findInviteById } from '@/features/invites/repo';
import { pool, q, withTx } from '@/lib/db';
import { payloadHash } from '@/lib/payload-hash';
import { hasStarted, isJonCancelled, isLazilyDone } from './guest-cancel';
import { hostLeft } from './joined-cascade';
import { releaseLiveOffers } from './offers';
import { honeypotField } from '@/lib/honeypot';
import { RequestBody } from './schema';
import {
  adminLink,
  enqueueCalendar,
  lockHostOf,
  noSideEffects,
  patchHostIfLocked,
  queuedId,
  runAfterCommit,
  type AfterCommit,
} from './side-effects';
import { validateRequest, type ValidationCode } from './validate';

/** The new choices only. Name, email, crew and the dish stay as they are (the same row). No stand-by here. */
export const RerequestChoices = RequestBody.pick({
  slotIds: true,
  dates: true,
  windowText: true,
  overnight: true,
  overnightNight: true, // pr80-review F2: a re-request replaces "Which night?" with the rest of the choices
  pitchIdea: true, // EML-05: after E8 ("Pitch me the shorter version?") a Pitch Me guest sends the shorter pitch
});
export type RerequestChoices = z.infer<typeof RerequestChoices>;
/**
 * The POST body: the choices, a per-submit clientKey (pr32-review M1: a double tap or a retry changes nothing
 * twice) and the shared honeypot (AD-9). Strict: a request_id in the body is a 400.
 */
export const RerequestBody = RerequestChoices.extend({ clientKey: z.uuid(), hp: honeypotField }).strict();

export type RerequestResult =
  | { ok: true }
  | { ok: false; status: 404; reason: 'request_not_found' }
  | { ok: false; status: 409; reason: 'not_changeable' | 'replay_conflict' }
  | { ok: false; status: 409; reason: ValidationCode };

const CHANGEABLE = new Set(['requested', 'needs_new_time', 'standby', 'locked']);

interface Row {
  status: string;
  dish: string;
  invite_id: string;
  contact_name: string;
  crew_size: number;
  guest_time_zone: string | null;
  pitch_idea: string | null;
  surprise_need_to_know: string | null;
  joined_to_request_id: string | null;
  ends_at: Date | null;
  starts_at: Date | null;
  google_event_id: string | null;
  calendar_state: string;
  cancelled_by: 'guest' | 'jon' | null;
  closed_in_person: boolean;
}

export interface Checked {
  mode: 'slots' | 'dates';
  countsToward: string;
  slotIds: string[];
  datePrefs: string | null;
  overnight: boolean;
  overnightNight: string | null;
  /** A new pitch (a Pitch Me request only); null keeps the stored one. */
  pitchIdea: string | null;
}

/** How many times or dates the new choices hold (E16's singular, Q6). */
function choiceCount(c: Checked): number {
  const dates = c.datePrefs ? ((JSON.parse(c.datePrefs) as { dates?: string[] }).dates ?? []) : [];
  return c.slotIds.length + dates.length;
}

const ROW = `select r.status, r.dish, r.invite_id, r.contact_name, r.crew_size, r.guest_time_zone, r.pitch_idea,
            r.surprise_need_to_know, r.joined_to_request_id, coalesce(h.locked_ends_at, r.locked_ends_at) as ends_at,
            coalesce(h.locked_starts_at, r.locked_starts_at) as starts_at,
            r.google_event_id, r.calendar_state, r.cancelled_by::text as cancelled_by, r.closed_in_person
       from request r left join request h on h.id = r.joined_to_request_id
      where r.id = $1`;

/**
 * Step 1, before the transaction: the new choices against the engine as it is now (C3; the same rules as a
 * first Send), with this request's own booking and offers not counting against its new pick. Like a first
 * Send, the pick is not held: Jon's Lock it in re-checks it (canLock).
 */
export async function checkRerequest(
  requestId: string,
  choices: RerequestChoices,
  now = new Date(),
): Promise<Checked | { code: ValidationCode | 'request_not_found' }> {
  const [r] = await q<Row>(ROW, [requestId]);
  if (!r) return { code: 'request_not_found' };
  return check(requestId, r, choices, now);
}

/** Step 2, inside the caller's transaction. */
/**
 * ENG-14: the guest's submit this key already made: 'none', 'same' (a retry or a double tap: its original success)
 * or 'conflict' (other choices under the same key: refused, never answered as if they went). An audit row from
 * before the hash was recorded replays as before.
 */
export async function replayOf(
  db: Pool | PoolClient,
  requestId: string,
  action: string,
  clientKey: string,
  hash: string,
): Promise<'none' | 'same' | 'conflict'> {
  const { rows } = await db.query<{ payload_hash: string | null }>(
    `select detail->>'payload_hash' as payload_hash from audit_log
      where request_id = $1 and action = $2 and detail->>'client_key' = $3`,
    [requestId, action, clientKey],
  );
  if (rows.length === 0) return 'none';
  return rows.some((r) => r.payload_hash === null || r.payload_hash === hash) ? 'same' : 'conflict';
}

/** The choices a client key stands for (ENG-14). */
export function choicesHash(choices: RerequestChoices): string {
  return payloadHash(choices);
}

const REPLAY_CONFLICT = { ok: false, status: 409, reason: 'replay_conflict' } as const;

export async function rerequestTx(
  c: PoolClient,
  a: {
    requestId: string;
    checked: Checked;
    now: Date;
    clientKey: string;
    payloadHash: string;
    action?: string;
    spam?: boolean;
  },
): Promise<{ result: RerequestResult; after: AfterCommit }> {
  const { requestId, checked, now } = a;
  const none = noSideEffects();
  await lockHostOf(c, requestId); // host first, then this row (pr48-review F3)
  const {
    rows: [r],
  } = await c.query<Row>(`${ROW} for update of r`, [requestId]);
  if (!r) return { result: { ok: false, status: 404, reason: 'request_not_found' }, after: none };
  // The same submit again (under the row lock, so a concurrent double tap waits and lands here): nothing to do.
  const replay = await replayOf(c, requestId, a.action ?? 'request_rerequested', a.clientKey, a.payloadHash);
  if (replay === 'same') return { result: { ok: true }, after: none };
  if (replay === 'conflict') return { result: REPLAY_CONFLICT, after: none };
  const jonCancelled = isJonCancelled(r);
  if (!(CHANGEABLE.has(r.status) || jonCancelled) || isLazilyDone(r, now) || hasStarted(r, now))
    return { result: { ok: false, status: 409, reason: 'not_changeable' }, after: none };

  const {
    rows: [audit],
  } = await c.query<{ id: string }>(
    `insert into audit_log (actor, action, request_id, detail) values ('guest', $2, $1, $3) returning id`,
    [
      requestId,
      a.action ?? 'request_rerequested',
      JSON.stringify({
        from_status: r.status,
        to_status: 'requested',
        client_key: a.clientKey,
        payload_hash: a.payloadHash,
      }),
    ],
  );
  const after = noSideEffects();
  if (jonCancelled) {
    // Jon's cancel already deleted the event (or dropped this joined guest from the host's) and released offers.
  } else if (r.joined_to_request_id) {
    // Rule 5: detach, and the host's event drops this attendee.
    const patch = await patchHostIfLocked(c, r.joined_to_request_id);
    if (patch) after.outboxIds.push(patch);
  } else if (r.status === 'locked') {
    after.outboxIds.push(await enqueueCalendar(c, 'calendar_delete', requestId));
    after.emailIds.push(...(await hostLeft(c, requestId, now, audit!.id))); // rule 4
    // T3.4.05 (AD-6): the .ics CANCEL, read before the locked time is cleared below.
    if (r.calendar_state === 'ics_sent')
      after.emailIds.push(...(await queueIcsEmail(c, requestId, 'CANCEL')));
  }
  // A locked booking's manage links ran to its end + 7 days; open again, they get the unlocked lifetime (§6).
  if (r.status === 'locked' || jonCancelled) await reopenManageTokens(c, [requestId], now);
  await c.query(
    `update request
        set status = 'requested', mode = $2, counts_toward = $3, date_prefs = $4, overnight = $5, standby_week = null,
            overnight_night = case when $5 then $8 else null end,
            joined_to_request_id = null, locked_slot_id = null, locked_starts_at = null, locked_ends_at = null,
            locked_where = null, awaiting_jon_since = case when $7 then null else $6::timestamptz end,
            cancelled_by = null, cancelled_at = null,
            spam_suspect = spam_suspect or $7, pitch_idea = coalesce($9, pitch_idea)
      where id = $1`,
    [
      requestId,
      checked.mode,
      checked.countsToward,
      checked.datePrefs,
      checked.overnight,
      now,
      a.spam ?? false,
      checked.overnightNight,
      checked.pitchIdea,
    ],
  );
  await c.query(`delete from request_slot_choice where request_id = $1`, [requestId]);
  for (const slotId of checked.slotIds) {
    await c.query(`insert into request_slot_choice (request_id, slot_id) values ($1, $2)`, [
      requestId,
      slotId,
    ]);
  }
  await releaseLiveOffers(c, requestId);
  // AD-9: a spam suspect goes to Jon's quiet Check these tab: no E16, not in Needs a reply.
  if (!a.spam)
    after.emailIds.push(
      ...queuedId(
        await queueEmail(c, {
          template: 'E16',
          to: jonEmail(),
          requestId,
          eventKey: a.clientKey,
          vars: {
            name: r.contact_name,
            dish: dishInSentence(r.dish),
            adminLink: adminLink(requestId),
            count: choiceCount(checked), // Q6: one time or date reads "picked a new time"
          },
        }),
      ),
    );
  return { result: { ok: true }, after };
}

async function check(
  requestId: string,
  r: Row,
  choices: RerequestChoices,
  now: Date,
): Promise<Checked | { code: ValidationCode }> {
  const dish = dishBySlug(r.dish);
  const invite = await findInviteById(r.invite_id);
  // EML-05: a new pitch counts on a Pitch Me request only (any other dish keeps none); blank keeps the stored one.
  const newPitch = dish?.flow === 'pitch' && choices.pitchIdea ? choices.pitchIdea : null;
  if (!dish || !invite) return { code: 'not_bookable' };
  const loaded = withoutOwnBooking(await loadEngineData(now), requestId);
  const season = { start: loaded.settings.seasonStart, end: loaded.settings.seasonEnd };
  const busy = await getBusy(season);
  const engine = openWindows(engineInput(loaded, busy, invite.kind, dish.windows, requestId));
  // The stored details stand in for the form fields a first Send would carry (validateRequest reads them).
  const body: RequestBody = {
    ...RequestBody.parse({
      clientKey: '00000000-0000-4000-8000-000000000000',
      dish: r.dish,
      name: r.contact_name,
      email: 'guest@example.com', // not used by validation; the row keeps its own
      crew: r.crew_size,
    }),
    ...choices,
    guestTimeZone: r.guest_time_zone ?? undefined,
    pitchIdea: newPitch ?? r.pitch_idea ?? undefined,
    surpriseNeedToKnow: r.surprise_need_to_know ?? undefined,
  };
  const v = validateRequest(body, dish, engine, season, now);
  if (!v.ok) return { code: v.code };
  return {
    mode: v.mode,
    countsToward: v.countsToward,
    slotIds: v.mode === 'slots' ? choices.slotIds : [],
    datePrefs:
      v.mode === 'dates'
        ? JSON.stringify({ dates: choices.dates, window_text: choices.windowText ?? null })
        : null,
    overnight: choices.overnight,
    overnightNight: (choices.overnight && choices.overnightNight) || null,
    pitchIdea: newPitch,
  };
}

export async function rerequest(
  requestId: string,
  choices: RerequestChoices,
  now = new Date(),
  opts: { clientKey: string; spam?: boolean },
): Promise<RerequestResult> {
  // ENG-03/ENG-14: a retry is answered from what it already did, before the choices are checked again (the time
  // may have gone since); other choices under the same key are refused.
  const hash = choicesHash(choices);
  const replay = await replayOf(pool(), requestId, 'request_rerequested', opts.clientKey, hash);
  if (replay === 'same') return { ok: true };
  if (replay === 'conflict') return REPLAY_CONFLICT;
  const checked = await checkRerequest(requestId, choices, now);
  if ('code' in checked) {
    return checked.code === 'request_not_found'
      ? { ok: false, status: 404, reason: 'request_not_found' }
      : { ok: false, status: 409, reason: checked.code };
  }
  const { result, after } = await withTx((c) =>
    rerequestTx(c, {
      requestId,
      checked,
      now,
      clientKey: opts.clientKey,
      payloadHash: hash,
      spam: opts.spam,
    }),
  );
  await runAfterCommit(after, 'rerequest');
  return result;
}
