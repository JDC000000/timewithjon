import { describe, expect, it } from 'vitest';
import { ERRORS } from '@/content';
import { dishBySlug } from '@/content/menu-helpers';
import { PICKER } from '@/content/ui/booking';
import { railDetailLines } from '../../PicksRail';
import { errorFor, pickErrors, withoutError } from '../form-errors';
import { dishPhotoSlot, dishView, flowNotices, pageTitle, pickerHeading, pickerLead } from '../flow-view';

const lunch = dishBySlug('the-long-lunch');
if (!lunch) throw new Error('menu changed');

describe('flow view (T1.5.U1, U4)', () => {
  it('serialises the dish with its course title', () => {
    expect(dishView(lunch)).toMatchObject({
      slug: 'the-long-lunch',
      name: 'The Long Lunch',
      course: 'Mains',
      flow: 'picker',
      dateRule: null,
      suggestions: [],
    });
  });
  it('splits the picker line into the heading and its lead, and titles the page the pack way', () => {
    expect(pickerHeading()).toBe('When works?');
    expect(pickerLead()).toBe('Tap as many as you like. I’ll lock one in.');
    expect(pageTitle({ name: 'The Long Lunch' })).toBe('When works? · The Long Lunch · Time with Jon');
  });
  it('says the away line with both dates, and nothing without a confirm-by date', () => {
    expect(flowNotices({ awayNotice: { until: '2027-05-03', confirmBy: '2027-05-05' } }).away).toBe(
      'I’m away until May 3. I’ll confirm by May 5.',
    );
    expect(flowNotices({ awayNotice: { until: '2027-05-03', confirmBy: null } }).away).toBeNull();
    expect(flowNotices({}).away).toBeNull();
  });
  it('says when booking opens, on the Vancouver date', () => {
    // 07:00 UTC on Mar 1 is still Feb 28 in Vancouver (2026: PST under tzdata 2026a and 2026c).
    expect(flowNotices({ opensAt: '2026-03-01T07:00:00.000Z' }).opensOn).toBe('Booking opens February 28.');
    expect(flowNotices({ opensAt: '2026-03-01T17:00:00.000Z' }).opensOn).toBe('Booking opens March 1.');
    expect(flowNotices({}).opensOn).toBeNull();
  });
  it('puts the rail detail on two lines: the time, then who it serves', () => {
    expect(railDetailLines('2 hr · Thu/Fri, noon–2 pm · serves 1–15 (my wallet prefers 1–6)')).toEqual([
      '2 hr · Thu/Fri, noon–2 pm',
      'serves 1–15 (my wallet prefers 1–6)',
    ]);
    expect(railDetailLines('any open time')).toEqual(['any open time']);
  });
});

describe('Send with no pick (T1.5.U5)', () => {
  it('asks for a time, linked to the month tab showing', () => {
    expect(pickErrors({ picks: [], standbyWeek: null }, 't-2027-05')).toEqual([
      { key: 'picks', target: 't-2027-05', inline: ERRORS.noTimes, summary: PICKER.noTimesSummary },
    ]);
  });
  it('is satisfied by a pick or a stand-by week', () => {
    expect(pickErrors({ picks: [], standbyWeek: null }, null)[0]?.target).toBe('picker');
    expect(pickErrors({ picks: ['a'], standbyWeek: null }, 't')).toEqual([]);
    expect(pickErrors({ picks: [], standbyWeek: '2027-04-12' }, 't')).toEqual([]);
  });
  it('drops an error by key and finds one', () => {
    const errs = pickErrors({ picks: [], standbyWeek: null }, 't');
    expect(withoutError(errs, 'picks')).toEqual([]);
    expect(errorFor(errs, 'picks')?.target).toBe('t');
    const none: never[] = [];
    expect(withoutError(none, 'picks')).toBe(none);
  });

  it('maps a dish slug to its v2.0 photo slot key', () => {
    expect(dishPhotoSlot('the-long-lunch')).toBe('long-lunch');
    expect(dishPhotoSlot('the-shore-ride')).toBe('shore-ride');
    expect(dishPhotoSlot('catch-and-release')).toBe('catch-release');
    expect(dishPhotoSlot('surprise-me')).toBe('surprise-me');
    expect(dishPhotoSlot('pitch-the-idea')).toBe('pitch-the-idea');
  });
});
