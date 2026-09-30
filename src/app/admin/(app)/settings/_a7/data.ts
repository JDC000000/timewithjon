// src/app/admin/(app)/settings/_a7/data.ts — T2.9.U1 / T3.3.U1: what the A7 pages read (server-only): the settings
// and people reached (T2.9.02), and the Google connection's health for the Calendar group (T3.3; the shell's banner reads googleBanner() itself).
// Only a state and a time leave here: never the account, a token or the calendar id.
import 'server-only';
import { adminCounts, readSettings, type AdminSettings } from '@/features/admin/settings';
import { BROKEN_REASONS } from '@/features/calendar/alerts';
import { calendarName } from '@/features/calendar/connection';
import { googleConfigured } from '@/lib/adapters/google/oauth';
import { q } from '@/lib/db';

/**
 * never = no connection yet (nothing to fix: no banner, as googleBanner); connected; broken = a dead grant
 * (BROKEN_REASONS: Jon must reconnect); disconnected = the token was dropped (Disconnect, or a revoked grant).
 */
export type GoogleState = 'never' | 'connected' | 'broken' | 'disconnected';

export interface CalendarStatus {
  state: GoogleState;
  lastOkAt: string | null;
  calendarName: string;
  /** false where no OAuth client is configured (the connect route would 404): no Connect button then */
  canConnect: boolean;
}

export async function calendarStatus(): Promise<CalendarStatus> {
  const [row] = await q<{ connected: boolean; last_ok_at: Date | null; last_error: string | null }>(
    `select refresh_token_enc is not null as connected, last_ok_at, last_error
       from oauth_connection where provider = 'google'`,
  );
  const state: GoogleState = !row
    ? 'never'
    : !row.connected
      ? 'disconnected'
      : row.last_error && BROKEN_REASONS.has(row.last_error)
        ? 'broken'
        : 'connected';
  return {
    state,
    lastOkAt: row?.last_ok_at?.toISOString() ?? null,
    calendarName: calendarName(),
    canConnect: googleConfigured(),
  };
}

export const settingsPage = (): Promise<AdminSettings> => readSettings();

export async function repliesPage(): Promise<{ settings: AdminSettings; peopleReached: number }> {
  const [settings, counts] = await Promise.all([readSettings(), adminCounts()]);
  return { settings, peopleReached: counts.peopleReached };
}
