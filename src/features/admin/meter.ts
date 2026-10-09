// src/features/admin/meter.ts — T2.2.04: the Big Day meter in the admin header (TSD F18). The screen words it
// ("Big Days: 3 of about 6"); this returns the two numbers. Server-only.
import 'server-only';
import { q } from '@/lib/db';

export interface BigDayMeter {
  count: number;
  target: number;
}

export async function bigDayMeter(): Promise<BigDayMeter> {
  const [row] = await q<{ count: number; target: number | null }>(
    // ENG-04: test-invite and spam-suspect bookings never count, as they never reach the export (pr50 F1/F2).
    `select (select count(*)::int from request
              where counts_toward = 'big_day' and status in ('locked','done') and joined_to_request_id is null
                and not is_test and not spam_suspect) as count,
            (select bigday_target from settings where id) as target`,
  );
  if (row?.target == null) throw new Error('settings row missing: run the seed');
  return { count: row.count, target: row.target };
}
