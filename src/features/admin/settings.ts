// src/features/admin/settings.ts — T2.9.02: the A7 settings read/update and counts (TSD T2.9, §6 `settings`,
// §12.5). Editable here: release times, reply promise, default cap, free/busy calendar IDs, the before-60 toggle.
// Google connect/health and Re-sync come with T3.3/T3.15. The engine reads settings on every call, so a change
// (e.g. personal_open_at) moves the picker at once (AC2). Server-only; every caller has passed requireAdmin().
import 'server-only';
import { z } from 'zod';
import { STORY_HAS_CONTENT } from '@/features/photos/story-content';
import { q, withTx } from '@/lib/db';
import { loadSettings, type SettingsRow } from '@/lib/settings';
import { ENDED } from './inbox';

const CALENDAR_ID = /^[^\s,]{1,254}$/; // "primary" or an address-like Google calendar id

export const SettingsPatch = z
  .strictObject({
    personalOpenAt: z.iso.datetime({ offset: true }),
    generalOpenAt: z.iso.datetime({ offset: true }),
    replyPromiseDays: z.number().int().min(1).max(14),
    defaultWeeklyCap: z.number().int().min(0).max(10), // the DB check's range
    freebusyCalendarIds: z
      .array(z.string().regex(CALENDAR_ID))
      .min(1)
      .max(10)
      .refine((a) => new Set(a).size === a.length, 'duplicate_calendar'),
    before60Enabled: z.boolean(),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'nothing_to_change' });
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export interface AdminSettings {
  env: SettingsRow['env'];
  seasonStart: string;
  seasonEnd: string;
  personalOpenAt: string;
  generalOpenAt: string;
  replyPromiseDays: number;
  defaultWeeklyCap: number;
  bigdayTarget: number;
  freebusyCalendarIds: string[];
  before60Enabled: boolean;
  householdHoldReleased: boolean;
  storyDeadline: string;
}

function toAdmin(s: SettingsRow): AdminSettings {
  return {
    env: s.env,
    seasonStart: s.season_start,
    seasonEnd: s.season_end,
    personalOpenAt: s.personal_open_at.toISOString(),
    generalOpenAt: s.general_open_at.toISOString(),
    replyPromiseDays: s.reply_promise_days,
    defaultWeeklyCap: s.default_weekly_cap,
    bigdayTarget: s.bigday_target,
    freebusyCalendarIds: s.freebusy_calendar_ids,
    before60Enabled: s.before60_enabled,
    householdHoldReleased: s.household_hold_released,
    storyDeadline: s.story_deadline,
  };
}

export async function readSettings(): Promise<AdminSettings> {
  return toAdmin(await loadSettings());
}

const COLUMN: Record<keyof SettingsPatch, string> = {
  personalOpenAt: 'personal_open_at',
  generalOpenAt: 'general_open_at',
  replyPromiseDays: 'reply_promise_days',
  defaultWeeklyCap: 'default_weekly_cap',
  freebusyCalendarIds: 'freebusy_calendar_ids',
  before60Enabled: 'before60_enabled',
};

const RELEASE_LOOKBACK_MS = 365 * 24 * 3600 * 1000;
type UpdateRefusal = 'personal_after_general' | 'release_out_of_range';

/**
 * Applies a partial update, checked against the locked row. The hoped-for list opens first: personal_open_at must
 * not be later than general_open_at (400 `personal_after_general`). Both release times must be within the last
 * year and before the season ends, or the picker would never open (400 `release_out_of_range`).
 */
export async function updateSettings(
  patch: SettingsPatch,
  now = new Date(),
): Promise<{ ok: true; settings: AdminSettings } | { ok: false; reason: UpdateRefusal }> {
  const refusal = await withTx(async (c): Promise<UpdateRefusal | null> => {
    const { rows } = await c.query<{ personal_open_at: Date; general_open_at: Date; season_ends_at: Date }>(
      `select personal_open_at, general_open_at,
              (season_end + 1)::timestamp at time zone 'America/Vancouver' as season_ends_at
         from settings where id for update`,
    );
    const row = rows[0]!;
    const personal = patch.personalOpenAt ? new Date(patch.personalOpenAt) : row.personal_open_at;
    const general = patch.generalOpenAt ? new Date(patch.generalOpenAt) : row.general_open_at;
    const inRange = (t: Date) => t.getTime() >= now.getTime() - RELEASE_LOOKBACK_MS && t < row.season_ends_at;
    if (![patch.personalOpenAt, patch.generalOpenAt].every((t) => !t || inRange(new Date(t)))) {
      return 'release_out_of_range';
    }
    if (personal > general) return 'personal_after_general';
    const keys = Object.keys(patch) as (keyof SettingsPatch)[];
    await c.query(
      `update settings set ${keys.map((k, i) => `${COLUMN[k]} = $${i + 1}`).join(', ')}, updated_at = now()
        where id`,
      keys.map((k) => patch[k]),
    );
    // The changed column names only, never their values (pr37 review F9).
    await c.query(`insert into audit_log (actor, action, detail) values ('jon', 'settings_updated', $1)`, [
      JSON.stringify({ fields: keys.map((k) => COLUMN[k]) }),
    ]);
    return null;
  });
  return refusal ? { ok: false, reason: refusal } : { ok: true, settings: await readSettings() };
}

export interface AdminCounts {
  requests: Record<'requested' | 'locked' | 'needs_new_time' | 'standby' | 'cancelled' | 'done', number>;
  checkThese: number;
  /** Locked + done bookings, groups count as one (§12.5 "confirmed bookings"). */
  confirmedBookings: number;
  /** §12.5 / M9: distinct guests with a done booking (joined guests included) + the people they brought. */
  peopleReached: number;
  guestsReached: number;
  /** Spam-suspect stories are counted apart (`spam`), never in total/consented/needsJon. */
  stories: { total: number; consented: number; needsJon: number; spam: number };
}

/**
 * A locked request whose end has passed counts as done (lazy done, T2.8); a joined request ends with its host.
 * people reached = distinct guests with a done booking + the rest of their crews. crew_size counts the guest
 * ("Just me." = 1), so each done booking adds crew_size − 1 companions and the guest is counted once.
 */
export async function adminCounts(now = new Date()): Promise<AdminCounts> {
  const [byStatus, reach, stories] = await Promise.all([
    q<{ status: keyof AdminCounts['requests'] | 'check'; n: number }>(
      `select case when r.spam_suspect then 'check'
                   when r.status = 'locked' and coalesce(${ENDED}, false) then 'done'
                   else r.status::text end as status, count(*)::int as n
         from request r left join request h on h.id = r.joined_to_request_id
        group by 1`,
      [now],
    ),
    q<{ guests: number; companions: number; confirmed: number }>(
      `with eff as (
         select r.guest_id, r.crew_size, r.joined_to_request_id,
                case when r.status = 'locked' and coalesce(${ENDED}, false) then 'done'
                     else r.status::text end as status
           from request r left join request h on h.id = r.joined_to_request_id
          where not r.spam_suspect)
       select count(distinct guest_id) filter (where status = 'done')::int as guests,
              coalesce(sum(crew_size - 1) filter (where status = 'done'), 0)::int as companions,
              count(*) filter (where status in ('locked', 'done') and joined_to_request_id is null)::int as confirmed
         from eff`,
      [now],
    ),
    q<{ total: number; consented: number; needs_jon: number; spam: number }>(
      `select count(*) filter (where not spam_suspect)::int as total,
              count(*) filter (where consent and not spam_suspect)::int as consented,
              count(*) filter (where consent_needs_jon and not spam_suspect)::int as needs_jon,
              count(*) filter (where spam_suspect)::int as spam
         from story s
        where ${STORY_HAS_CONTENT}`,
    ),
  ]);
  const requests: AdminCounts['requests'] = {
    requested: 0,
    locked: 0,
    needs_new_time: 0,
    standby: 0,
    cancelled: 0,
    done: 0,
  };
  let checkThese = 0;
  for (const row of byStatus) {
    if (row.status === 'check') checkThese = row.n;
    else requests[row.status] = row.n;
  }
  const r = reach[0]!;
  const s = stories[0]!;
  return {
    requests,
    checkThese,
    confirmedBookings: r.confirmed,
    guestsReached: r.guests,
    peopleReached: r.guests + r.companions,
    stories: { total: s.total, consented: s.consented, needsJon: s.needs_jon, spam: s.spam },
  };
}
