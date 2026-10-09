// src/features/email/budget.ts — the UTC-day email counter (AD-5). Created early for admin sign-in (T2.1.07);
// T3.2.03: app email takes its slot through takeAppSlot(), with the ceiling T3.2.04's guard sets for its class.
import 'server-only';
import { getEnv, type AppMode } from '@/config/env';
import { q } from '@/lib/db';

export type SlotKind = 'app' | 'signin';
export interface Slot {
  day: string; // YYYY-MM-DD, UTC
  count: number; // today's sent_count, this send included
}

/** AD-7 / review F1: the P0 sign-in cap per UTC day. Set in code by APP_MODE, never by an env var. */
export const SIGNIN_CAP: Record<AppMode, number> = { production: 8, prototype: 2, staging: 2 };
/**
 * Of the cap, this many sign-in emails a day are kept for the admin's known device (features/admin/known-device.ts):
 * a start from any other browser stops at SIGNIN_CAP - this, so the admin's own sign-in always has room.
 */
export const SIGNIN_KNOWN_DEVICE_RESERVE: Record<AppMode, number> = {
  production: 2,
  prototype: 1,
  staging: 1,
};

/**
 * Reserves one send in today's row, atomically. A sign-in slot also bumps signin_count, and only while it's
 * under the cap (for a browser that isn't the admin's known device, under the cap less the kept slots): no row
 * back means capped (null). App slots are never capped here.
 */
export async function takeSlot(
  kind: SlotKind = 'app',
  mode: AppMode = getEnv().APP_MODE,
  knownDevice = false,
): Promise<Slot | null> {
  const cap = knownDevice ? SIGNIN_CAP[mode] : SIGNIN_CAP[mode] - SIGNIN_KNOWN_DEVICE_RESERVE[mode];
  const rows = await q<Slot>(
    `insert into email_budget (utc_day, sent_count, signin_count)
     values ((now() at time zone 'utc')::date, 1, $1)
     on conflict (utc_day) do update
       set sent_count = email_budget.sent_count + 1,
           signin_count = email_budget.signin_count + $1,
           updated_at = now()
       where $1 = 0 or email_budget.signin_count < $2
     returning utc_day::text as day, sent_count as count`,
    [kind === 'signin' ? 1 : 0, cap],
  );
  return rows[0] ?? null;
}

/**
 * Gives a slot back (a definite non-send never counts). Never takes a counter below zero. `limitHit` also marks
 * the day full in the SAME statement (a Resend quota 429), so no reader sees the freed slot as open.
 */
export async function releaseSlot(kind: SlotKind, day: string, limitHit = false): Promise<void> {
  await q(
    `update email_budget
       set sent_count = sent_count - 1, signin_count = signin_count - $1, updated_at = now(),
           limit_hit_at = case when $3 then coalesce(limit_hit_at, now()) else limit_hit_at end
     where utc_day = $2::date and sent_count > 0 and signin_count >= $1`,
    [kind === 'signin' ? 1 : 0, day, limitHit],
  );
}

export type AppSlot =
  | { taken: true; day: string; count: number }
  | { taken: false; day: string; count: number; limitHit: boolean };

/**
 * pr31 review M1: takes an app slot only while today's count is under `ceiling` and the day isn't marked full,
 * decided inside the one atomic upsert. A refusal changes nothing (no take-then-give-back), so parking a P2/P3
 * can never push a concurrent P1 over its ceiling. On a refusal it reports what it saw so the guard can choose.
 */
export async function takeAppSlot(ceiling: number): Promise<AppSlot> {
  const [taken] = await q<{ day: string; count: number }>(
    `insert into email_budget (utc_day, sent_count) values ((now() at time zone 'utc')::date, 1)
     on conflict (utc_day) do update
       set sent_count = email_budget.sent_count + 1, updated_at = now()
       where email_budget.sent_count < $1 and email_budget.limit_hit_at is null
     returning utc_day::text as day, sent_count as count`,
    [ceiling],
  );
  if (taken) return { taken: true, ...taken };
  const [seen] = await q<{ day: string; count: number; limitHit: boolean }>(
    `select utc_day::text as day, sent_count as count, limit_hit_at is not null as "limitHit"
       from email_budget where utc_day = (now() at time zone 'utc')::date`,
  );
  // No row: the UTC day rolled over between the two statements. Report an empty, open day.
  return { taken: false, ...(seen ?? { day: '', count: 0, limitHit: false }) };
}

/** T3.2.07: the day's "Email limit reached" moment (a P1 email had to wait, or Resend refused for quota). */
export async function markLimitHit(day: string): Promise<void> {
  await q(
    `insert into email_budget (utc_day, limit_hit_at) values ($1::date, now())
     on conflict (utc_day) do update set limit_hit_at = coalesce(email_budget.limit_hit_at, now()), updated_at = now()`,
    [day],
  );
}
