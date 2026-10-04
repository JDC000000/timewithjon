// The ONE block rule (rules.ts blockedBy): canLock, Suggest another time and the block-confirm move all ask it, so a
// window can't be "blocked" for one and free for another. A window running past midnight into a blocked day, or
// into a single-window block's times, is shut; one that only touches the other window of that day is not.
import { describe, expect, it } from 'vitest';
import { canLock, type CanLockInput } from '@/features/availability';
import { baseInput, slot } from '@/features/availability/fixtures';
import { blockedBy } from '@/features/availability/rules';
import type { Block, Range } from '@/features/availability/types';
import { vancouverInstant } from '@/lib/time';

const base = baseInput();
const released = { ...base.settings, householdHoldReleased: true };
const range = (d1: string, t1: string, d2: string, t2: string): Range => ({
  startsAt: vancouverInstant(d1, t1),
  endsAt: vancouverInstant(d2, t2),
});
const lunchBlock: Block = {
  startDate: '2027-05-13',
  endDate: '2027-05-13',
  kind: 'blocked',
  confirmBy: null,
  window: 'lunch',
  windowRange: range('2027-05-13', '12:00', '2027-05-13', '14:00'),
};
const dayBlock: Block = { startDate: '2027-05-14', endDate: '2027-05-14', kind: 'blocked', confirmBy: null };
const lock = (target: CanLockInput['target'], blocks: Block[]): CanLockInput => ({
  now: base.now,
  request: { id: 'me', status: 'requested', countsToward: 'none', dish: 'the-encore' },
  mode: 'lock',
  target,
  bookings: [],
  blocks,
  weeks: base.weeks,
  offers: [],
  settings: released,
});
/** canLock's answer and blockedBy's agree, for every window and block below. */
const same = (target: CanLockInput['target'], blocks: Block[]) => {
  const shut = blockedBy(target, blocks, released) !== null;
  const r = canLock(lock(target, blocks));
  expect(r.ok ? 'open' : r.reason).toBe(shut ? 'blocked' : 'open');
  return shut;
};

describe('blockedBy, the one block rule', () => {
  it('a range over midnight into a whole-day block, or into a single-window block’s times, is shut', () => {
    expect(same({ range: range('2027-05-13', '22:00', '2027-05-14', '01:00') }, [dayBlock])).toBe(true);
    expect(same({ range: range('2027-05-12', '22:00', '2027-05-13', '13:00') }, [lunchBlock])).toBe(true);
  });

  it('the other window of a single-window block’s day, or a range ending at its start, is open', () => {
    expect(same({ slot: slot(base, '2027-05-13', 'evening') }, [lunchBlock])).toBe(false);
    expect(same({ range: range('2027-05-12', '22:00', '2027-05-13', '12:00') }, [lunchBlock])).toBe(false);
    expect(same({ slot: slot(base, '2027-05-13', 'lunch') }, [lunchBlock])).toBe(true);
  });

  it('names what shuts it: the block, or the household hold while it stands', () => {
    expect(
      blockedBy({ range: range('2027-05-14', '09:00', '2027-05-14', '10:00') }, [dayBlock], released),
    ).toBe(dayBlock);
    const hold = { range: range('2027-04-01', '11:00', '2027-04-01', '13:00') };
    expect(blockedBy(hold, [], base.settings)).toBe('household_hold');
    expect(blockedBy(hold, [], released)).toBeNull();
  });
});
