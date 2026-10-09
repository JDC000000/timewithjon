// CR-01 (full review 2026-10-08): what a lock on a slot counts toward comes from the dish, never from the row, and a
// slot (one lunch or evening window) is never a Big Day.
import { describe, expect, it } from 'vitest';
import { DISHES } from '@/content/menu';
import { dishBySlug } from '@/content/menu-helpers';
import { slotCountsToward, windowFitsDish } from '@/features/availability/rules';

describe('slotCountsToward', () => {
  it('every slots dish counts its slot toward the week, as validate.ts stores it', () => {
    for (const d of DISHES.filter((x) => x.mode !== 'dates')) expect(slotCountsToward(d)).toBe('weekly_cap');
  });
  it('a Big Day dish (or a pitch) on a slot counts toward the week, not as a Big Day; a call counts toward nothing', () => {
    expect(slotCountsToward(dishBySlug('the-shore-ride'))).toBe('weekly_cap');
    expect(slotCountsToward(dishBySlug('pitch-me'))).toBe('weekly_cap');
    expect(slotCountsToward(dishBySlug('the-long-distance'))).toBe('none');
    expect(slotCountsToward(undefined)).toBe('weekly_cap');
  });
});

describe('windowFitsDish', () => {
  it('follows the dish windows; a dates-only or unknown dish fits none', () => {
    expect(windowFitsDish(dishBySlug('the-long-lunch'), 'lunch')).toBe(true);
    expect(windowFitsDish(dishBySlug('the-long-lunch'), 'evening')).toBe(false);
    expect(windowFitsDish(dishBySlug('the-old-haunt'), 'evening')).toBe(true);
    expect(windowFitsDish(dishBySlug('the-encore'), 'lunch')).toBe(false);
    expect(windowFitsDish(undefined, 'lunch')).toBe(false);
  });
});
