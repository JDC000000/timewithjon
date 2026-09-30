// src/features/admin/season-windows.ts — T2.5.06: the A4 week's per-WINDOW block state. Each Thu/Fri window of one
// season week: open, blocked (a whole-day block, or a block on just this window) or away, and the block that closes
// it, by the engine's own rule (windowBlock: the whole day wins). Bookings, taps and the cap stay in the season
// view (T2.5.03); the household hold is settings.household_hold_released there. Server-only; callers have passed
// requireAdmin().
import 'server-only';
import { windowBlock } from '@/features/availability/rules';
import type { Block, WindowKind } from '@/features/availability/types';
import { q } from '@/lib/db';
import { addDays } from '@/lib/time';

export interface WindowState {
  slotId: string;
  date: string;
  window: WindowKind;
  startsAt: string;
  endsAt: string;
  /** open = no block (it may still hold a booking: see the season view); blocked = Jon's block; away = away mode. */
  state: 'open' | 'blocked' | 'away';
  /** The block that closes it: `day` = a whole-day block or away range, `window` = a block on this window only. */
  block: { id: string; scope: 'day' | 'window' } | null;
}

/** The week's windows in time order, or null when weekStart isn't a seeded season week. */
export async function weekWindows(weekStart: string): Promise<WindowState[] | null> {
  const weekEnd = addDays(weekStart, 6);
  const [week, slots, blocks] = await Promise.all([
    q<{ week_start: string }>(`select week_start::text from week where week_start = $1::date`, [weekStart]),
    q<{ id: string; date: string; window_kind: WindowKind; starts_at: Date; ends_at: Date }>(
      `select id, date::text, window_kind, starts_at, ends_at from slot
        where date between $1::date and $2::date order by starts_at, id`,
      [weekStart, weekEnd],
    ),
    q<{
      id: string;
      start_date: string;
      end_date: string;
      kind: Block['kind'];
      window_kind: WindowKind | null;
    }>(
      `select id, start_date::text, end_date::text, kind, window_kind from availability_block
        where start_date <= $2::date and end_date >= $1::date order by start_date, id`,
      [weekStart, weekEnd],
    ),
  ]);
  if (!week[0]) return null;
  const engineBlocks = blocks.map((b) => ({
    id: b.id,
    startDate: b.start_date,
    endDate: b.end_date,
    kind: b.kind,
    confirmBy: null,
    window: b.window_kind,
  }));
  return slots.map((s): WindowState => {
    const closing = windowBlock({ date: s.date, windowKind: s.window_kind }, engineBlocks);
    return {
      slotId: s.id,
      date: s.date,
      window: s.window_kind,
      startsAt: s.starts_at.toISOString(),
      endsAt: s.ends_at.toISOString(),
      state: !closing ? 'open' : closing.kind === 'away' ? 'away' : 'blocked',
      block: closing ? { id: closing.id, scope: closing.window == null ? 'day' : 'window' } : null,
    };
  });
}
