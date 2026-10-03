import { describe, expect, it } from 'vitest';
import { EMPTY_SELECTION, hasTimes, isPicked, selectionReducer as r } from '../selection';

describe('selection (T1.5.U2/U3)', () => {
  it('toggles picks in tap order', () => {
    let s = r(EMPTY_SELECTION, { type: 'toggle', slotId: 'b' });
    s = r(s, { type: 'toggle', slotId: 'a' });
    expect(s.picks).toEqual(['b', 'a']);
    expect(isPicked(s, 'a')).toBe(true);
    s = r(s, { type: 'toggle', slotId: 'b' });
    expect(s.picks).toEqual(['a']);
    expect(isPicked(s, 'b')).toBe(false);
  });
  it('Remove only ever un-picks', () => {
    const s = r(EMPTY_SELECTION, { type: 'toggle', slotId: 'a' });
    expect(r(s, { type: 'remove', slotId: 'a' }).picks).toEqual([]);
    expect(r(s, { type: 'remove', slotId: 'x' })).toBe(s);
  });
  it('stand-by replaces the picks, and a pick replaces the stand-by (never both: standby_not_allowed)', () => {
    let s = r(EMPTY_SELECTION, { type: 'toggle', slotId: 'a' });
    s = r(s, { type: 'standby', weekStart: '2027-04-12', on: true });
    expect(s).toEqual({ picks: [], standbyWeek: '2027-04-12' });
    s = r(s, { type: 'standby', weekStart: '2027-05-31', on: true });
    expect(s.standbyWeek).toBe('2027-05-31');
    expect(r(s, { type: 'toggle', slotId: 'b' })).toEqual({ picks: ['b'], standbyWeek: null });
  });
  it('un-ticking stand-by clears only its own week', () => {
    const s = r(EMPTY_SELECTION, { type: 'standby', weekStart: '2027-04-12', on: true });
    expect(r(s, { type: 'standby', weekStart: '2027-04-12', on: false }).standbyWeek).toBeNull();
    expect(r(s, { type: 'standby', weekStart: '2027-05-31', on: false })).toBe(s);
  });
  it('Send needs a time or a stand-by week (T1.5.U5)', () => {
    expect(hasTimes(EMPTY_SELECTION)).toBe(false);
    expect(hasTimes({ picks: ['a'], standbyWeek: null })).toBe(true);
    expect(hasTimes({ picks: [], standbyWeek: '2027-04-12' })).toBe(true);
  });

  it('restore (QA M3): picks, or one stand-by week, never both', () => {
    expect(r(EMPTY_SELECTION, { type: 'restore', picks: ['a', 'b'], standbyWeek: '2027-04-12' })).toEqual({
      picks: ['a', 'b'],
      standbyWeek: null,
    });
    expect(r(EMPTY_SELECTION, { type: 'restore', picks: [], standbyWeek: '2027-04-12' })).toEqual({
      picks: [],
      standbyWeek: '2027-04-12',
    });
  });
});
