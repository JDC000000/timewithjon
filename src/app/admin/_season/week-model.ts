// src/app/admin/_season/week-model.ts — T2.5.U1 / T3.5.U1: the A4b week pane, shaped from one season week (T2.5.03)
// and that week's windows (slots). Pure: no DB, no React. One Open/Blocked choice per DATE (blocks are date-granular;
// orchestrator ruling Q1), with that date's windows listed under it: "noon–2 pm · Open", "7 pm · Locked · Robin".
import { SEASON, WEEK } from '@/content/ui/admin-season';
import { HOUSEHOLD_HOLD } from '@/features/availability/rules';
import type { Slot } from '@/features/availability/types';
import type { SeasonBlock, SeasonWeek } from '@/features/admin/season-view';
import { addDays, vancouverDate } from '@/lib/time';
import { dateLabel, weekCount, windowTime } from './model';

export interface WindowLine {
  key: string;
  /** "noon–2 pm" / "7 pm". */
  time: string;
  /** "Open", "Blocked by you", "Locked · Robin", "Busy on your calendar"… */
  note: string;
  /** A locked (or done) booking in this window: its request, for the "Open › Robin’s booking" link. */
  booking: { id: string; name: string } | null;
}

export type DateState = 'open' | 'blocked' | 'away' | 'past';

export interface DateRow {
  date: string;
  /** "Thu Apr 15". */
  label: string;
  state: DateState;
  /** Jon can flip this date here: not past, not away, and not inside a longer block (that one is undone as a whole). */
  editable: boolean;
  /** The one-day block to delete when this date goes back to Open. */
  blockId: string | null;
  windows: WindowLine[];
}

export interface StandbyRow {
  id: string;
  name: string;
  /** "Chris · The Flat White". */
  who: string;
  /** "Mon Mar 1". */
  since: string;
  /** The first window this week open for their dish, or null. */
  offer: { slotId: string; label: string } | null;
}

export interface WeekDetail {
  weekStart: string;
  weekEnd: string;
  /** "Apr 12" (after "Week of"). */
  label: string;
  count: string;
  /** "Apr 15–16": the dates that have windows. */
  heading: string;
  dates: DateRow[];
  /** The whole week (Mon–Sun) under one block. `blockId` only when exactly that block exists (undo = delete it). */
  wholeWeek: { blocked: boolean; blockId: string | null; editable: boolean };
  allowThird: boolean;
  standby: StandbyRow[];
}

export interface WeekInput {
  week: SeasonWeek;
  /** This week's slots (any order). */
  slots: Slot[];
  /** Today, local (Vancouver). */
  today: string;
  seasonEnd: string;
  householdHoldReleased: boolean;
  defaultWeeklyCap: number;
  /** Per stand-by entry id: the slot to offer, or null. */
  offers: Map<string, Slot | null>;
}

const covers = (b: SeasonBlock, date: string) => b.startDate <= date && b.endDate >= date;

/** "Apr 15–16", "Apr 29–May 1", "Apr 15" (the first and last dates of the list). */
export function dateSpan(first: string, last: string): string {
  if (first === last) return dateLabel(first, 'MMM d');
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return `${dateLabel(first, 'MMM d')}–${dateLabel(last, sameMonth ? 'd' : 'MMM d')}`;
}

function windowNote(
  slot: Slot,
  state: DateState,
  i: Pick<WeekInput, 'week' | 'householdHoldReleased'>,
): Pick<WindowLine, 'note' | 'booking'> {
  const start = slot.startsAt.getTime();
  const end = slot.endsAt.getTime();
  const bk = i.week.bookings.find(
    (b) => new Date(b.startsAt).getTime() < end && new Date(b.endsAt).getTime() > start,
  );
  if (bk) {
    const word = bk.status === 'done' ? WEEK.done : WEEK.locked;
    return { note: `${word} · ${bk.contactName}`, booking: { id: bk.id, name: bk.contactName } };
  }
  if (state === 'away') return { note: SEASON.awayWeek, booking: null };
  if (state === 'blocked') return { note: WEEK.blockedByYou, booking: null };
  if (
    !i.householdHoldReleased &&
    slot.date === HOUSEHOLD_HOLD.date &&
    slot.windowKind === HOUSEHOLD_HOLD.windowKind
  ) {
    return { note: WEEK.heldForFamily, booking: null };
  }
  const busy = i.week.busy.some(
    (m) => new Date(m.startsAt).getTime() < end && new Date(m.endsAt).getTime() > start,
  );
  if (busy) return { note: WEEK.busy, booking: null };
  return { note: state === 'past' ? '' : WEEK.open, booking: null };
}

export function weekDetail(i: WeekInput): WeekDetail {
  const { week } = i;
  const weekEnd = addDays(week.weekStart, 6);
  const byDate = new Map<string, Slot[]>();
  for (const s of [...i.slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    if (s.date < week.weekStart || s.date > weekEnd) continue;
    byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  }
  const blocked = week.blocks.filter((b) => b.kind === 'blocked');
  const away = week.blocks.filter((b) => b.kind === 'away');

  const dates: DateRow[] = [...byDate.entries()].map(([date, slots]) => {
    const block = blocked.find((b) => covers(b, date)) ?? null;
    const state: DateState =
      date < i.today ? 'past' : away.some((b) => covers(b, date)) ? 'away' : block ? 'blocked' : 'open';
    const oneDay = block && block.startDate === date && block.endDate === date ? block : null;
    return {
      date,
      label: dateLabel(date, 'EEE MMM d'),
      state,
      editable: state === 'open' || (state === 'blocked' && oneDay !== null),
      blockId: state === 'blocked' ? (oneDay?.id ?? null) : null,
      windows: slots.map((s) => ({
        key: s.id,
        time: windowTime(s.windowKind, s.startsAt, s.endsAt),
        ...windowNote(s, state, i),
      })),
    };
  });

  const whole = blocked.find((b) => b.startDate <= week.weekStart && b.endDate >= weekEnd) ?? null;
  const exact = whole && whole.startDate === week.weekStart && whole.endDate === weekEnd ? whole : null;
  const anyFuture = weekEnd >= i.today;
  const first = dates[0]?.date;
  const last = dates[dates.length - 1]?.date;

  return {
    weekStart: week.weekStart,
    weekEnd,
    label: dateLabel(week.weekStart, 'MMM d'),
    count: weekCount(week, i.seasonEnd),
    heading: first && last ? dateSpan(first, last) : dateLabel(week.weekStart, 'MMM d'),
    dates,
    wholeWeek: {
      blocked: whole !== null,
      blockId: exact?.id ?? null,
      editable: anyFuture && (whole === null || exact !== null),
    },
    allowThird: (week.capOverride ?? i.defaultWeeklyCap) >= 3,
    standby: week.standby.map((s) => {
      const slot = i.offers.get(s.id) ?? null;
      return {
        id: s.id,
        name: s.contactName,
        who: s.dishName ? `${s.contactName} · ${s.dishName}` : s.contactName,
        since: dateLabel(vancouverDate(new Date(s.createdAt)), 'EEE MMM d'),
        offer: slot
          ? {
              slotId: slot.id,
              label: `${dateLabel(slot.date, 'EEE')} ${windowTime(slot.windowKind, slot.startsAt, slot.endsAt)}`,
            }
          : null,
      };
    }),
  };
}
