// src/lib/settings.ts — the single settings row (§6).
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { pool } from '@/lib/db';
import type { EngineSettings } from '@/features/availability/types';

export interface SettingsRow {
  env: 'prototype' | 'staging' | 'production';
  season_start: string;
  season_end: string;
  personal_open_at: Date;
  general_open_at: Date;
  default_weekly_cap: number;
  bigday_target: number;
  freebusy_calendar_ids: string[];
  reply_promise_days: number;
  before60_enabled: boolean;
  household_hold_released: boolean;
  story_deadline: string;
}
/** `db` = a transaction's client when called inside one (T2.3: never a second pool connection, review H1). */
export async function loadSettings(db: Pool | PoolClient = pool()): Promise<SettingsRow> {
  const { rows } = await db.query<SettingsRow>(
    `select env, season_start::text, season_end::text, personal_open_at, general_open_at, default_weekly_cap,
            bigday_target, freebusy_calendar_ids, reply_promise_days, before60_enabled, household_hold_released,
            story_deadline::text
       from settings where id`,
  );
  if (!rows[0]) throw new Error('settings row missing: run the seed');
  return rows[0];
}
export function toEngineSettings(s: SettingsRow): EngineSettings {
  return {
    seasonStart: s.season_start,
    seasonEnd: s.season_end,
    personalOpenAt: s.personal_open_at,
    generalOpenAt: s.general_open_at,
    defaultWeeklyCap: s.default_weekly_cap,
    householdHoldReleased: s.household_hold_released,
  };
}
