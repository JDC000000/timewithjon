// T2.3.U1: the dates-mode Lock sheet rules.
import { describe, expect, it } from 'vitest';
import {
  commitLabel,
  commitParts,
  defaultCountsToward,
  defaultsFor,
  lengthOptions,
  lengthWords,
  parseClock,
  startOptions,
} from './lock-sheet';

describe('parseClock (Other…)', () => {
  it('reads the house style and 24 h', () => {
    expect(parseClock('10:30 am')).toBe('10:30');
    expect(parseClock('10:30am')).toBe('10:30');
    expect(parseClock(' 7 PM ')).toBe('19:00');
    expect(parseClock('12 pm')).toBe('12:00');
    expect(parseClock('12 am')).toBe('00:00');
    expect(parseClock('12:15 a.m.')).toBe('00:15');
    expect(parseClock('noon')).toBe('12:00');
    expect(parseClock('midnight')).toBe('00:00');
    expect(parseClock('19:15')).toBe('19:15');
    expect(parseClock('7:30')).toBe('07:30');
    expect(parseClock('13')).toBe('13:00');
    expect(parseClock('0')).toBe('00:00');
  });
  it('refuses what isn’t a time, and a bare "7"', () => {
    for (const bad of ['', 'soon', '7', '13 pm', '0 am', '24:00', '10:60', '10:3 am', '1030']) {
      expect(parseClock(bad), bad).toBeNull();
    }
  });
});

describe('defaults and counts', () => {
  it('a dish’s defaults, a fallback, and the Start options in clock order', () => {
    expect(defaultsFor('catch-and-release')).toEqual({ start: '07:00', minutes: 480 });
    expect(defaultsFor('unknown')).toEqual({ start: '09:00', minutes: 120 });
    expect(startOptions('the-shore-ride')).toEqual(['07:00', '09:00', '12:00']);
    expect(startOptions('the-encore')).toEqual(['07:00', '09:00', '12:00', '19:00']);
  });
  it('counts toward: the dish’s dates rule; a pitch by its length', () => {
    expect(defaultCountsToward('the-shore-ride', 45)).toBe('big_day');
    expect(defaultCountsToward('the-old-haunt', 120)).toBe('big_day'); // weekend Old Haunt: datesCountToward
    expect(defaultCountsToward('the-long-distance', 120)).toBe('none');
    expect(defaultCountsToward('pitch-me', 240)).toBe('big_day');
    expect(defaultCountsToward('pitch-me', 239)).toBe('weekly_cap');
    expect(defaultCountsToward('nope', 480)).toBe('weekly_cap');
  });
  it('length words and the commit', () => {
    expect(lengthWords(240)).toBe('half a day');
    expect(lengthWords(90)).toBe('90 min');
    expect(commitLabel('2027-05-08', '09:00')).toBe('Lock in Sat May 8, 9 am');
    expect(commitLabel('2027-05-08', '10:30')).toBe('Lock in Sat May 8, 10:30 am');
    expect(commitLabel('2027-06-12', '12:00')).toBe('Lock in Sat Jun 12, noon');
  });
  it('the commit as the button’s two parts (QA L4: the verb, then the day and time, never split at the comma)', () => {
    expect(commitParts('2027-04-03', '09:00')).toEqual({ verb: 'Lock in', when: 'Sat Apr 3, 9 am' });
    const p = commitParts('2027-06-12', '12:00');
    expect(`${p.verb} ${p.when}`).toBe(commitLabel('2027-06-12', '12:00'));
  });
});

describe('QA4 M1: the overnight length', () => {
  it('is offered on a dish that allows a night away, or when the guest asked; picked when they asked', () => {
    const words = (dish: string, overnight?: boolean) => lengthOptions(dish, overnight).map((l) => l.words);
    expect(words('the-grind')).toContain('one night away');
    expect(words('pitch-me')).toContain('one night away');
    expect(words('the-encore')).not.toContain('one night away');
    expect(words('the-encore', true)).toContain('one night away');
    expect(defaultsFor('the-grind', true)).toEqual({ start: '15:00', minutes: 20 * 60 }); // 3 pm to 11 am
    expect(startOptions('the-grind', true)).toContain('15:00');
    expect(startOptions('the-grind')).not.toContain('15:00');
    expect(defaultsFor('the-grind')).toEqual({ start: '09:00', minutes: 240 });
    expect(lengthWords(20 * 60)).toBe('one night away');
  });
  it('stays inside what the lock API takes (72 h)', () => {
    for (const l of lengthOptions('pitch-me', true)) expect(l.minutes).toBeLessThanOrEqual(72 * 60);
  });
});

describe('r5 N-L3', () => {
  it('The Long Distance opens on its own 45 min (the dish says "45 min · phone or video")', () => {
    expect(defaultsFor('the-long-distance')).toEqual({ start: '18:00', minutes: 45 });
  });
});
