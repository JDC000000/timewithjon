import { describe, expect, it } from 'vitest';
import { underWayLine } from '../admin-season';

describe('T2.5.05 underWayLine', () => {
  it('names one booking in the approved words', () => {
    expect(underWayLine(1)).toBe('1 booking is under way and will finish as planned.');
  });
  it('pluralises for more than one', () => {
    expect(underWayLine(2)).toBe('2 bookings are under way and will finish as planned.');
    expect(underWayLine(12)).toBe('12 bookings are under way and will finish as planned.');
  });
  it('says nothing when none are under way', () => {
    expect(underWayLine(0)).toBeNull();
    expect(underWayLine(-1)).toBeNull();
  });
});
