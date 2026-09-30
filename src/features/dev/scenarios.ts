// src/lib/dev/scenarios.ts — /dev/state scenarios (T1.10 AC2). Prototype DB only.
import 'server-only';
import type { PoolClient } from 'pg';

export const SCENARIOS = ['empty', 'full-week', 'away', 'household-hold', 'surprise-me'] as const;
export type Scenario = (typeof SCENARIOS)[number];
/** Markers for every row a scenario writes, so a reset never touches real social-test data. */
export const SCENARIO_EMAIL = 'scenario@example.com';
export const SCENARIO_NOTE = 'dev scenario';

export async function applyScenario(c: PoolClient, s: Scenario): Promise<void> {
  // Reset: remove ONLY what scenarios created (M8). Social-test guests use the is_test invites too, so
  // "delete where is_test" would destroy their requests and cascade to their stories and photos.
  await c.query(`delete from request where contact_email = $1`, [SCENARIO_EMAIL]);
  await c.query(`delete from availability_block where note = $1`, [SCENARIO_NOTE]);
  await c.query(`update settings set household_hold_released = true`); // the one global switch scenarios own
  if (s === 'empty') return;
  if (s === 'household-hold') {
    await c.query(`update settings set household_hold_released = false`);
    return;
  }
  if (s === 'away') {
    await c.query(
      `insert into availability_block (start_date, end_date, kind, confirm_by, note) values ('2027-04-26','2027-05-03','away','2027-05-05',$1)`,
      [SCENARIO_NOTE],
    );
    return;
  }
  const {
    rows: [g],
  } = await c.query<{ id: string }>(
    `insert into guest (email) values ('scenario@example.com') on conflict (email) do update set email = excluded.email returning id`,
  );
  const {
    rows: [inv],
  } = await c.query<{ id: string }>(`select id from invite where kind = 'general' and revoked_at is null`);
  const lock = (date: string, win: 'lunch' | 'evening', dish: string) =>
    c.query(
      `insert into request (is_test, client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, status, counts_toward, locked_slot_id, locked_starts_at, locked_ends_at)
     select true, gen_random_uuid(), $1, $2, 'Scenario', 'scenario@example.com', $3, 'slots', 'locked', 'weekly_cap', s.id, s.starts_at, s.ends_at
       from slot s where s.date = $4 and s.window_kind = $5`,
      [g!.id, inv!.id, dish, date, win],
    );
  if (s === 'full-week') {
    await lock('2027-05-13', 'lunch', 'the-long-lunch');
    await lock('2027-05-14', 'evening', 'the-first-round');
    return;
  }
  if (s === 'surprise-me') {
    await c.query(
      `insert into request (is_test, client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, status, counts_toward, surprise_need_to_know, surprise_plan_sealed, awaiting_jon_since)
       values (true, gen_random_uuid(), $1, $2, 'Alex', 'scenario@example.com', 'surprise-me', 'slots', 'requested', 'weekly_cap', 'Thursday evening, Lonsdale, bring a jacket', 'SEALED-PLAN-CANARY', now())`,
      [g!.id, inv!.id],
    );
  }
}
