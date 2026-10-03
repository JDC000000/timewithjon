// QA H2: the weather-call date grid covers the season only (from today when the season has started), never the
// months around today.
import { describe, expect, it } from 'vitest';
import { newDateSpan } from '../span';

const SEASON = { start: '2027-04-01', end: '2027-06-30' };

describe('newDateSpan (QA H2)', () => {
  it('before the season: the whole season', () => {
    expect(newDateSpan(SEASON, '2026-10-03')).toEqual(SEASON);
  });
  it('in the season: from today to the season end', () => {
    expect(newDateSpan(SEASON, '2027-05-12')).toEqual({ start: '2027-05-12', end: '2027-06-30' });
  });
  it('on the last day: that day only', () => {
    expect(newDateSpan(SEASON, '2027-06-30')).toEqual({ start: '2027-06-30', end: '2027-06-30' });
  });
  it('after the season: nothing to pick', () => {
    expect(newDateSpan(SEASON, '2027-07-01')).toBeNull();
  });
});
