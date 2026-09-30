// src/app/admin/_season/data.ts — T2.5.U1: what the A4 pages read (server-only). The season view (T2.5.03 + the
// T3.5.02 busy markers), the Big Day meter, and for one week its windows and the first window open for each
// stand-by guest's dish (the C3 engine's isSlotOpen, as the inbox does in src/features/admin/times.ts).
// Never the sealed plan: every read here goes through the features' explicit column lists.
import 'server-only';
import { dishBySlug } from '@/content/menu-helpers';
import { bigDayMeter } from '@/features/admin/meter';
import { seasonView, type SeasonView } from '@/features/admin/season-view';
import { getBusy } from '@/features/availability/busy';
import { engineInput, loadEngineData } from '@/features/availability/load';
import { isSlotOpen } from '@/features/availability/openWindows';
import { bigDayDates } from '@/features/availability/rules';
import type { Slot } from '@/features/availability/types';
import { addDays, vancouverDate } from '@/lib/time';
import { currentAway, weekRows } from './model';
import { weekDetail, type WeekDetail } from './week-model';

export interface SeasonPage {
  view: SeasonView;
  seasonEnd: string;
  today: string;
  meter: { count: number; target: number };
  rows: ReturnType<typeof weekRows>;
  away: ReturnType<typeof currentAway>;
}

type Loaded = Awaited<ReturnType<typeof loadEngineData>>;

export async function seasonPage(now = new Date(), engine?: Promise<Loaded>): Promise<SeasonPage> {
  const [view, meter, loaded] = await Promise.all([
    seasonView(now),
    bigDayMeter(),
    engine ?? loadEngineData(now),
  ]);
  const seasonEnd = loaded.settings.seasonEnd;
  const today = vancouverDate(now);
  return {
    view,
    seasonEnd,
    today,
    meter,
    rows: weekRows(view, seasonEnd),
    away: currentAway(view, today),
  };
}

/** The A4b pane for one week, or null when it isn't a season week. */
export async function weekPage(
  weekStart: string,
  now = new Date(),
): Promise<{ page: SeasonPage; week: WeekDetail } | null> {
  const engine = loadEngineData(now);
  const [page, loaded] = await Promise.all([seasonPage(now, engine), engine]);
  const week = page.view.weeks.find((w) => w.weekStart === weekStart);
  if (!week) return null;
  const weekEnd = addDays(weekStart, 6);
  const slots = loaded.slots.filter((s) => s.date >= weekStart && s.date <= weekEnd);

  const offers = new Map<string, Slot | null>();
  if (week.standby.length > 0) {
    const busy = await getBusy({ start: loaded.settings.seasonStart, end: loaded.settings.seasonEnd }, now);
    const bigDays = bigDayDates(loaded.bookings);
    const sorted = [...slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    for (const s of week.standby) {
      const input = engineInput(loaded, busy, 'personal', dishBySlug(s.dish)?.windows ?? [], s.id);
      offers.set(s.id, sorted.find((slot) => isSlotOpen(slot, input, bigDays)) ?? null);
    }
  }

  return {
    page,
    week: weekDetail({
      week,
      slots,
      today: page.today,
      seasonEnd: page.seasonEnd,
      householdHoldReleased: page.view.householdHoldReleased,
      defaultWeeklyCap: page.view.defaultWeeklyCap,
      offers,
    }),
  };
}
