// src/app/admin/_season/model.ts — T2.5.U1 / T3.5.U1: the A4 season list, shaped from the season view (T2.5.03 +
// T3.5.02 busy markers). Pure: no DB, no React. Each week row = "Week of Mar 29", the count ("1 of 2", "Away", or
// "Mon–Wed" for the season's last short week) and its notes in the pack's order (a4-season: held, blocked, Big
// Day, busy, away, stand-by, season end). The words come from src/content/ui/admin-season.ts.
import { formatInTimeZone } from 'date-fns-tz';
import { SEASON } from '@/content/ui/admin-season';
import { HOUSEHOLD_HOLD } from '@/features/availability/rules';
import type { SeasonView, SeasonWeek } from '@/features/admin/season-view';
import { addDays, TZ, vancouverInstant } from '@/lib/time';

/** One note on a week row: `lead` + the day (no-wrap) + ` · ` + the time (no-wrap) + `text`. */
export interface WeekNote {
  key: string;
  lead?: string;
  day?: string;
  time?: string;
  text?: string;
}

export interface WeekRow {
  weekStart: string;
  /** "Mar 29" (after SEASON.weekOf). */
  label: string;
  count: string;
  away: boolean;
  notes: WeekNote[];
}

/** A local date ('2027-04-01') in a date-fns pattern, read at Vancouver noon so no zone shifts the day. */
export function dateLabel(date: string, pattern: string): string {
  return formatInTimeZone(vancouverInstant(date, '12:00'), TZ, pattern);
}

/** "noon", "7 pm", "9:30 am" (Vancouver). */
export function clock(instant: Date): string {
  const h = Number(formatInTimeZone(instant, TZ, 'H'));
  const m = formatInTimeZone(instant, TZ, 'mm');
  if (h === 12 && m === '00') return 'noon';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m === '00' ? '' : `:${m}`} ${h < 12 ? 'am' : 'pm'}`;
}

/** "noon–2 pm", "9–11 am", "11 am–1 pm", "7–9 pm". The first meridiem is dropped when both share it. */
export function timeRange(start: Date, end: Date): string {
  const a = clock(start);
  const b = clock(end);
  const sameHalf = a !== 'noon' && b !== 'noon' && a.slice(-2) === b.slice(-2);
  return `${sameHalf ? a.slice(0, -3) : a}–${b}`;
}

/** A booking window as the pack names it: lunch "noon–2 pm" (a range), evening "7 pm" (its start). */
export function windowTime(window: 'lunch' | 'evening', start: Date, end: Date): string {
  return window === 'evening' ? clock(start) : timeRange(start, end);
}

const dayOf = (instant: Date) => formatInTimeZone(instant, TZ, 'EEE MMM d');

/** The notes of one week, in the pack's order. `seasonEnd` = the last local date of the season. */
export function weekNotes(
  week: SeasonWeek,
  view: Pick<SeasonView, 'householdHoldReleased'>,
  seasonEnd: string,
): WeekNote[] {
  const weekEnd = addDays(week.weekStart, 6);
  const notes: WeekNote[] = [];
  const hold = HOUSEHOLD_HOLD.date;
  if (!view.householdHoldReleased && hold >= week.weekStart && hold <= weekEnd) {
    const start = vancouverInstant(hold, '12:00');
    const end = vancouverInstant(hold, '14:00');
    notes.push({
      key: 'hold',
      day: dayOf(start),
      time: windowTime(HOUSEHOLD_HOLD.windowKind, start, end),
      text: SEASON.heldForFamily,
    });
  }
  for (const b of week.blocks.filter((x) => x.kind === 'blocked')) {
    const from = b.startDate < week.weekStart ? week.weekStart : b.startDate;
    const to = b.endDate > weekEnd ? weekEnd : b.endDate;
    const day =
      from === to
        ? dateLabel(from, 'EEE MMM d')
        : `${dateLabel(from, 'EEE MMM d')} – ${dateLabel(to, 'EEE MMM d')}`;
    notes.push({ key: `block-${b.id}`, day, text: SEASON.blocked });
  }
  for (const bk of week.bookings.filter((x) => x.countsToward === 'big_day')) {
    notes.push({
      key: `bigday-${bk.id}`,
      lead: SEASON.bigDay,
      day: dayOf(new Date(bk.startsAt)),
      text: `(${bk.contactName})`,
    });
  }
  for (const m of week.busy) {
    const start = new Date(m.startsAt);
    notes.push({
      key: `busy-${m.startsAt}`,
      day: dayOf(start),
      time: timeRange(start, new Date(m.endsAt)),
      text: SEASON.busy,
    });
  }
  const away = awayBlock(week);
  if (away) {
    notes.push({
      key: `away-${away.id}`,
      lead: SEASON.awayWeek,
      text: `${dateLabel(away.startDate, 'MMM d')} – ${dateLabel(away.endDate, 'MMM d')}`,
    });
  }
  if (week.standby.length > 0) notes.push({ key: 'standby', text: SEASON.standby(week.standby.length) });
  if (seasonEnd >= week.weekStart && seasonEnd < weekEnd) {
    notes.push({ key: 'end', lead: SEASON.seasonEnds, day: dateLabel(seasonEnd, 'EEE MMM d') });
    notes.push({ key: 'end-only', text: SEASON.lastWeekOnly });
  }
  return notes;
}

/** The away range covering the WHOLE week (the pack marks only those weeks "Away"), or null. */
export function awayBlock(week: SeasonWeek) {
  const weekEnd = addDays(week.weekStart, 6);
  return (
    week.blocks.find((b) => b.kind === 'away' && b.startDate <= week.weekStart && b.endDate >= weekEnd) ??
    null
  );
}

/** The count cell: "Away", "Mon–Wed" for the season's last short week, else "1 of 2". */
export function weekCount(week: SeasonWeek, seasonEnd: string): string {
  if (awayBlock(week)) return SEASON.awayWeek;
  const weekEnd = addDays(week.weekStart, 6);
  if (seasonEnd >= week.weekStart && seasonEnd < weekEnd) {
    return `${dateLabel(week.weekStart, 'EEE')}–${dateLabel(seasonEnd, 'EEE')}`;
  }
  return SEASON.cap(week.capUsed, week.cap);
}

export function weekRows(view: SeasonView, seasonEnd: string): WeekRow[] {
  return view.weeks.map((w) => ({
    weekStart: w.weekStart,
    label: dateLabel(w.weekStart, 'MMM d'),
    count: weekCount(w, seasonEnd),
    away: awayBlock(w) !== null,
    notes: weekNotes(w, view, seasonEnd),
  }));
}

/** The away range to show on the list card: the one running now, else the next one; null when none is ahead. */
export function currentAway(view: SeasonView, today: string) {
  const seen = new Map<string, SeasonWeek['blocks'][number]>();
  for (const w of view.weeks) for (const b of w.blocks) if (b.kind === 'away') seen.set(b.id, b);
  return (
    [...seen.values()]
      .filter((b) => b.endDate >= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null
  );
}
