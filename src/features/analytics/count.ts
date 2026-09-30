// src/features/analytics/count.ts — T3.11.01 (TSD T3.11): counts only. One event_count row per Vancouver day and
// event, incremented in place: no ids, no IPs, no user agents, no third-party tracker. Bots and HEAD requests are
// filtered by the callers (isPreviewBot). A caller inside a transaction passes its client, so the count commits
// or rolls back with the action it counts.
import 'server-only';
import type { PoolClient } from 'pg';
import { q } from '@/lib/db';
import { vancouverDate } from '@/lib/time';

export const EVENTS = [
  'invite_opened',
  'dish_sheet_opened',
  'picker_opened',
  'request_sent',
  'locked',
  'story_added',
  'photo_added',
] as const;
export type EventName = (typeof EVENTS)[number];
/** The two a browser reports itself (POST /api/events): the sheet and the picker open without a server request. */
export const BEACON_EVENTS = ['dish_sheet_opened', 'picker_opened'] as const satisfies readonly EventName[];

const UPSERT = `insert into event_count (day, name, count) values ($1::date, $2, 1)
  on conflict (day, name) do update set count = event_count.count + 1`;

export async function countEvent(name: EventName, c?: PoolClient, now = new Date()): Promise<void> {
  const params = [vancouverDate(now), name];
  if (c) await c.query(UPSERT, params);
  else await q(UPSERT, params);
}
