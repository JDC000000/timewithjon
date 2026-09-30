// src/features/jobs/token-health.ts — T3.9.04 (TSD T3.9 AC2, H4): once a day from 07:00 PT, check Jon's Google
// connection through the calendar adapter (refresh + calendars.get, T3.4). 'revoked' goes to #41's single E14 sender (P1). The day is
// claimed in system_status first, so exactly one tick runs the check; a transient error gives the day back for the
// next tick, up to 3 tries a day (pr42 F6; T3.14's immediate path also catches a live invalid_grant). E14's
// template belongs to lane L5.
import 'server-only';
import { sendE14Once } from '@/features/calendar/alerts';
import type { SendResult } from '@/features/email/send';
import { adapters } from '@/lib/adapters';
import type { CalendarHealth } from '@/lib/adapters/types';
import { q } from '@/lib/db';
import { vancouverDate, vancouverInstant } from '@/lib/time';

export const TOKEN_HEALTH_AT = '07:00';
const CLAIM_KEY = 'token_health_day';
const FAILS_KEY = 'token_health_fails';
/** pr42 F6: a check that throws (a timeout, a 5xx) gives the day back, so a later tick retries; at most 3 tries a day. */
export const TOKEN_HEALTH_MAX_TRIES = 3;

/** true for exactly one caller per Vancouver date, from `at` PT. */
async function claimDay(now: Date, at: string): Promise<boolean> {
  const day = vancouverDate(now);
  if (now < vancouverInstant(day, at)) return false;
  const rows = await q(
    `insert into system_status (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()
       where system_status.value is distinct from excluded.value
     returning key`,
    [CLAIM_KEY, day],
  );
  return rows.length === 1;
}

/** Counts today's failed tries; under the cap, the day's claim is given back so the next 15-minute tick retries. */
async function releaseDayAfterFailure(now: Date): Promise<void> {
  const day = vancouverDate(now);
  const [row] = await q<{ value: string }>(
    `insert into system_status (key, value, updated_at) values ($1, $2 || ':1', now())
     on conflict (key) do update
       set value = case when split_part(system_status.value, ':', 1) = $2
                        then $2 || ':' || (split_part(system_status.value, ':', 2)::int + 1)
                        else $2 || ':1' end,
           updated_at = now()
     returning value`,
    [FAILS_KEY, day],
  );
  const tries = Number(row!.value.split(':')[1]);
  if (tries < TOKEN_HEALTH_MAX_TRIES)
    await q(`update system_status set value = null where key = $1 and value = $2`, [CLAIM_KEY, day]);
}

export async function checkTokenHealth(
  now: Date,
): Promise<{ health: CalendarHealth; e14: SendResult | 'recent' | null } | 'not_due'> {
  if (!(await claimDay(now, TOKEN_HEALTH_AT))) return 'not_due';
  let health: CalendarHealth;
  try {
    health = await adapters().calendar.health();
  } catch (e) {
    await releaseDayAfterFailure(now);
    throw e;
  }
  // pr42 F1 RULING: E14 has ONE sender (#41's sendE14Once: last_error for the banner, one E14 per 6 h).
  return { health, e14: health === 'revoked' ? await sendE14Once('revoked', now) : null };
}
