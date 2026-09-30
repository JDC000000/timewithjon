// T3.11: today's (Vancouver) count for one event, for integration tests.
import { q } from '@/lib/db';
import type { EventName } from '@/features/analytics/count';
import { vancouverDate } from '@/lib/time';

export async function todayCount(name: EventName): Promise<number> {
  const rows = await q<{ count: number }>(
    `select count from event_count where day = $1::date and name = $2`,
    [vancouverDate(new Date()), name],
  );
  return rows[0]?.count ?? 0;
}
