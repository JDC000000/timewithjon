// T2.5.06: a block on ONE window (lunch or evening) of a Thu/Fri. It closes only that window in the picker and at
// lock time; a whole-day block still closes both (and wins over a window block); the other window stays bookable.
import { describe, expect, it } from 'vitest';
import { canLock, openWindows, type CanLockInput } from '@/features/availability';
import { baseInput, slot } from '@/features/availability/fixtures';
import { isSlotOpen } from '@/features/availability/openWindows';
import { bigDayDates, blockCovering, windowBlock } from '@/features/availability/rules';
import type { Block, EngineInput, WindowKind } from '@/features/availability/types';
import { goneReason } from '@/features/admin/times';
import { vancouverInstant } from '@/lib/time';

const base = baseInput();
const THU = '2027-05-13';
const FRI = '2027-05-14';
const WEEK = '2027-05-10';

/** A window block as the loader builds it: the date, the window and that window's slot times. */
const windowBlk = (date: string, w: WindowKind): Block => {
  const s = slot(base, date, w);
  return {
    startDate: date,
    endDate: date,
    kind: 'blocked',
    confirmBy: null,
    window: w,
    windowRange: { startsAt: s.startsAt, endsAt: s.endsAt },
  };
};
const dayBlk = (from: string, to = from, kind: Block['kind'] = 'blocked'): Block => ({
  startDate: from,
  endDate: to,
  kind,
  confirmBy: kind === 'away' ? to : null,
  window: null,
  windowRange: null,
});

const pickerWeek = (input: EngineInput) => openWindows(input).weeks.find((w) => w.weekStart === WEEK)!;
const open = (input: EngineInput) => pickerWeek(input).windows.map((w) => `${w.date} ${w.window}`);

const lockInput = (over: Partial<CanLockInput>): CanLockInput => ({
  now: base.now,
  request: { id: 'me', status: 'requested', countsToward: 'weekly_cap', dish: 'the-long-lunch' },
  mode: 'lock',
  target: { slot: slot(base, THU, 'lunch') },
  bookings: [],
  blocks: [],
  weeks: base.weeks,
  offers: [],
  settings: base.settings,
  ...over,
});
const range = (date: string, from: string, to: string) => ({
  range: { startsAt: vancouverInstant(date, from), endsAt: vancouverInstant(date, to) },
});

describe('T2.5.06 openWindows: a window-level block', () => {
  it('closes only that window; the other window of the day stays open', () => {
    const got = open(baseInput({ blocks: [windowBlk(THU, 'lunch')] }));
    expect(got).not.toContain(`${THU} lunch`);
    expect(got).toContain(`${THU} evening`);
    expect(got).toContain(`${FRI} lunch`);
    expect(got).toHaveLength(3);
  });
  it('a whole-day block closes both windows', () => {
    const got = open(baseInput({ blocks: [dayBlk(THU)] }));
    expect(got).toEqual([`${FRI} lunch`, `${FRI} evening`]);
  });
  it('a whole-day block still wins over a window block on the same date', () => {
    const blocks = [windowBlk(THU, 'evening'), dayBlk(THU)];
    expect(open(baseInput({ blocks }))).toEqual([`${FRI} lunch`, `${FRI} evening`]);
    expect(windowBlock(slot(base, THU, 'lunch'), blocks)).toBe(blocks[1]);
    expect(windowBlock(slot(base, THU, 'evening'), blocks)).toBe(blocks[1]);
  });
  it('matches the window and the date: another date or window is untouched', () => {
    const blocks = [windowBlk(THU, 'lunch')];
    expect(windowBlock(slot(base, THU, 'lunch'), blocks)).toBe(blocks[0]);
    expect(windowBlock(slot(base, THU, 'evening'), blocks)).toBeUndefined();
    expect(windowBlock(slot(base, FRI, 'lunch'), blocks)).toBeUndefined();
    expect(windowBlock(slot(base, '2027-05-20', 'lunch'), blocks)).toBeUndefined();
  });
  it("isn't a whole-day block: the dates grid keeps the date, and blockCovering ignores it", () => {
    const input = baseInput({ blocks: [windowBlk(THU, 'lunch'), windowBlk(THU, 'evening')] });
    expect(openWindows(input).unavailableDates).not.toContain(THU);
    expect(blockCovering(THU, input.blocks)).toBeUndefined();
    expect(openWindows(baseInput({ blocks: [dayBlk(THU)] })).unavailableDates).toContain(THU);
  });
  it('every window of a week window-blocked = spoken for (never away); a day away range = away', () => {
    const all = [THU, FRI].flatMap((d) => [windowBlk(d, 'lunch'), windowBlk(d, 'evening')]);
    expect(pickerWeek(baseInput({ blocks: all })).state).toBe('spoken_for');
    expect(pickerWeek(baseInput({ blocks: [dayBlk(WEEK, '2027-05-16', 'away')] })).state).toBe('away');
  });
  it("the inbox's goneReason agrees: blocked for the window, open for the other", () => {
    const input = baseInput({ blocks: [windowBlk(THU, 'evening')] });
    const bigDays = bigDayDates(input.bookings);
    expect(goneReason(slot(input, THU, 'evening'), input, bigDays)).toBe('blocked');
    expect(goneReason(slot(input, THU, 'lunch'), input, bigDays)).toBeNull();
    for (const s of input.slots) {
      expect(goneReason(s, input, bigDays) === null, s.id).toBe(isSlotOpen(s, input, bigDays));
    }
  });
});

describe('T2.5.06 canLock: a window-level block', () => {
  it('refuses a lock in the blocked window; Book anyway overrides it', () => {
    const blocks = [windowBlk(THU, 'lunch')];
    expect(canLock(lockInput({ blocks }))).toEqual({ ok: false, reason: 'blocked' });
    expect(canLock(lockInput({ blocks, bookAnyway: true })).ok).toBe(true);
  });
  it('refuses by date and window even without the window times', () => {
    const blocks = [{ ...windowBlk(THU, 'lunch'), windowRange: null }];
    expect(canLock(lockInput({ blocks }))).toEqual({ ok: false, reason: 'blocked' });
  });
  it('the open window of the same day still locks', () => {
    const blocks = [windowBlk(THU, 'lunch')];
    const r = canLock(lockInput({ blocks, target: { slot: slot(base, THU, 'evening') } }));
    expect(r).toEqual({ ok: true, warnings: [] });
  });
  it('a whole-day block refuses both windows', () => {
    for (const w of ['lunch', 'evening'] as const) {
      const r = canLock(lockInput({ blocks: [dayBlk(THU)], target: { slot: slot(base, THU, w) } }));
      expect(r).toEqual({ ok: false, reason: 'blocked' });
    }
  });
  it('a range lock over the blocked window is refused; one clear of it locks', () => {
    const blocks = [windowBlk(THU, 'lunch')];
    const bigDay = {
      id: 'me',
      status: 'requested' as const,
      countsToward: 'big_day' as const,
      dish: 'the-grind',
    };
    expect(canLock(lockInput({ blocks, request: bigDay, target: range(THU, '08:00', '16:00') }))).toEqual({
      ok: false,
      reason: 'blocked',
    });
    expect(canLock(lockInput({ blocks, request: bigDay, target: range(THU, '14:00', '18:00') })).ok).toBe(
      true,
    );
  });
});
