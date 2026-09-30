// src/lib/engine/fixtures.ts — test builders mirroring the T0.2 seeds (52 slots, 14 weeks).
import { addDays, isoWeekday, vancouverInstant } from '@/lib/time';
import type { Booking, CountsToward, EngineInput, EngineSettings, Slot, Week, WindowKind } from './types';

export const DEFAULT_SETTINGS: EngineSettings = {
  seasonStart: '2027-04-01',
  seasonEnd: '2027-06-30',
  personalOpenAt: new Date('2027-02-25T16:00:00Z'),
  generalOpenAt: new Date('2027-03-01T16:00:00Z'),
  defaultWeeklyCap: 2,
  householdHoldReleased: false,
};

export function buildSlots(): Slot[] {
  const out: Slot[] = [];
  for (let d = '2027-04-01'; d <= '2027-06-30'; d = addDays(d, 1)) {
    if (![4, 5].includes(isoWeekday(d))) continue;
    out.push({
      id: `${d}-lunch`,
      date: d,
      windowKind: 'lunch',
      startsAt: vancouverInstant(d, '12:00'),
      endsAt: vancouverInstant(d, '14:00'),
    });
    out.push({
      id: `${d}-evening`,
      date: d,
      windowKind: 'evening',
      startsAt: vancouverInstant(d, '19:00'),
      endsAt: vancouverInstant(d, '22:00'),
    });
  }
  return out;
}

export function buildWeeks(): Week[] {
  const out: Week[] = [];
  for (let w = '2027-03-29'; w <= '2027-06-28'; w = addDays(w, 7))
    out.push({ weekStart: w, capOverride: null });
  return out;
}

export function slot(input: EngineInput, date: string, w: WindowKind): Slot {
  const s = input.slots.find((x) => x.date === date && x.windowKind === w);
  if (!s) throw new Error(`no slot ${date} ${w}`);
  return s;
}

let n = 0;
export function booking(
  date: string,
  from: string,
  to: string,
  countsToward: CountsToward,
  extra: Partial<Booking> = {},
): Booking {
  n += 1;
  const endDate = to < from ? addDays(date, 1) : date;
  return {
    requestId: `r${n}`,
    startsAt: vancouverInstant(date, from),
    endsAt: vancouverInstant(endDate, to),
    countsToward,
    joinedToRequestId: null,
    ...extra,
  };
}

export function baseInput(over: Partial<EngineInput> = {}): EngineInput {
  return {
    now: new Date('2027-03-10T18:00:00Z'), // after both release times, before the season
    slots: buildSlots(),
    weeks: buildWeeks(),
    bookings: [],
    blocks: [],
    offers: [],
    settings: { ...DEFAULT_SETTINGS },
    busy: [],
    inviteKind: 'general',
    dishWindows: ['lunch', 'evening'],
    ...over,
  };
}
