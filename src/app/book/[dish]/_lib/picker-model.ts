// S6 picker view model (T1.5.U2-U4): the C3 engine output -> month tabs of week rows, in the pack's shape.
// Pure: the page and the client picker render this; no logic in JSX.
import { collapseSpokenFor } from '@/features/availability/collapse';
import type { WeekOut, WindowKind, WindowOut } from '@/features/availability/types';
import { WINDOW_WORDS } from '@/content/ui/booking';
import { windowNameParts } from '@/features/availability/a11y';
import { addCivilDays, dayRange, monthName, shortDate } from './civil';

export interface TileView {
  slotId: string;
  date: string;
  window: WindowKind;
  /** Visible day, "Thu". */
  day: string;
  /** Visible time, "noon" or "7 pm". */
  time: string;
  /** The hidden rest of the accessible name, "noon–2 pm, May 6" (day + spoken = accessibleWindowName). */
  spoken: string;
  /** The line used in the picks list and announcements, "Thu May 6 · noon–2 pm". */
  label: string;
}

export type PickerRow =
  | { kind: 'week'; key: string; caption: string; tiles: TileView[] }
  | { kind: 'spoken'; key: string; caption: string; weekStart: string }
  | { kind: 'away'; key: string; caption: string }
  | { kind: 'run'; key: string; weekStart: string; firstCaption: string; lastCaption: string };

export interface PickerMonth {
  /** "April" */
  name: string;
  /** "2027-04": stable across renders (a React key and the tab/panel id). */
  key: string;
  rows: PickerRow[];
}

/** Guests book Thursdays and Fridays: a week reads as its Thu–Fri pair, "Apr 1–2" (pack s06). */
export function weekCaption(weekStart: string): string {
  return dayRange(addCivilDays(weekStart, 3), addCivilDays(weekStart, 4));
}

export function tileView(w: Pick<WindowOut, 'slotId' | 'date' | 'window'>): TileView {
  const words = WINDOW_WORDS[w.window];
  const name = windowNameParts(w);
  return {
    slotId: w.slotId,
    date: w.date,
    window: w.window,
    day: name.day,
    time: words.short,
    spoken: name.rest,
    label: `${shortDate(w.date)} · ${words.full}`,
  };
}

function rowsFor(weeks: WeekOut[]): PickerRow[] {
  const rows: PickerRow[] = [];
  for (const item of collapseSpokenFor(weeks)) {
    if (item.kind === 'spoken_run') {
      const first = item.weeks[0]?.weekStart ?? '';
      const last = item.weeks.at(-1)?.weekStart ?? first;
      rows.push({
        kind: 'run',
        key: `run-${first}`,
        weekStart: first,
        firstCaption: weekCaption(first),
        lastCaption: weekCaption(last),
      });
      continue;
    }
    const w = item.week;
    const caption = weekCaption(w.weekStart);
    if (w.state === 'spoken_for')
      rows.push({ kind: 'spoken', key: w.weekStart, caption, weekStart: w.weekStart });
    else if (w.state === 'away') rows.push({ kind: 'away', key: w.weekStart, caption });
    else if (w.state === 'open' && w.windows.length > 0)
      rows.push({ kind: 'week', key: w.weekStart, caption, tiles: w.windows.map(tileView) });
    // 'closed' (before booking opens) and open weeks with no time for this dish show nothing.
  }
  return rows;
}

/** Months in season order; a week (or a collapsed run) belongs to the month of its first Thursday. */
export function pickerMonths(weeks: WeekOut[]): PickerMonth[] {
  const months: PickerMonth[] = [];
  for (const row of rowsFor(weeks)) {
    const thursday = addCivilDays(rowWeekStart(row), 3);
    const key = thursday.slice(0, 7);
    let month = months.find((m) => m.key === key);
    if (!month) {
      month = { name: monthName(thursday), key, rows: [] };
      months.push(month);
    }
    month.rows.push(row);
  }
  return months;
}

function rowWeekStart(row: PickerRow): string {
  return row.kind === 'week' || row.kind === 'away' ? row.key : row.weekStart;
}

export function monthTileIds(month: PickerMonth): string[] {
  return month.rows.flatMap((r) => (r.kind === 'week' ? r.tiles.map((t) => t.slotId) : []));
}

export function monthStandbyWeeks(month: PickerMonth): string[] {
  return month.rows.flatMap((r) => (r.kind === 'spoken' || r.kind === 'run' ? [r.weekStart] : []));
}

/**
 * The month shown first: the one holding the first pick (or the stand-by week), else the first month with a time
 * to pick, else the first month.
 */
export function initialMonth(
  months: PickerMonth[],
  picks: readonly string[],
  standbyWeek: string | null,
): string {
  const holding = months.find(
    (m) =>
      monthTileIds(m).some((id) => picks.includes(id)) ||
      (standbyWeek !== null && monthStandbyWeeks(m).includes(standbyWeek)),
  );
  const firstOpen = months.find((m) => monthTileIds(m).length > 0);
  return (holding ?? firstOpen ?? months[0])?.key ?? '';
}

/** Every tile by id, for the picks list (in season order, not tap order: pack s06 rail). */
export function tilesInOrder(months: PickerMonth[]): TileView[] {
  return months.flatMap((m) => m.rows.flatMap((r) => (r.kind === 'week' ? r.tiles : [])));
}
