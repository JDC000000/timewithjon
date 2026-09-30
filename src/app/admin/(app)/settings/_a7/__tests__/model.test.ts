// T2.9.U1 / T3.3.U1 / T3.15.U1: the A7 rules (wireframe 09 A7, A7b, A7c, A7d).
import { describe, expect, it } from 'vitest';
import { ERRORS } from '@/content';
import {
  checkedLabel,
  googleResultLine,
  openingPatch,
  openingRefusal,
  promiseChoices,
  repliesPatch,
  resyncLine,
  splitRelease,
  timeChoices,
  timeLabel,
} from '../model';

// The proto/staging releases: personal Thu Feb 26 2026 8 am PST, general Mon Mar 2 8 am PST.
// Dates sit before 2026-11-01 so the offset is PST (-8) under tzdata 2026a and 2026c alike.
const saved = { personalOpenAt: '2026-02-26T16:00:00.000Z', generalOpenAt: '2026-03-02T16:00:00.000Z' };
const form = {
  personalDate: '2026-02-26',
  personalTime: '08:00',
  generalDate: '2026-03-02',
  generalTime: '08:00',
};

describe('A7b opening times', () => {
  it('shows each release as its Vancouver date and hour', () => {
    expect(splitRelease(saved.personalOpenAt)).toEqual({ date: '2026-02-26', time: '08:00' });
    expect(splitRelease('2026-03-03T06:30:00Z')).toEqual({ date: '2026-03-02', time: '22:30' });
  });
  it('labels hours on the admin 12-hour clock', () => {
    expect(['06:00', '11:00', '12:00', '13:00', '00:00', '13:30', '09:05'].map(timeLabel)).toEqual([
      '6 am',
      '11 am',
      'noon',
      '1 pm',
      '12 am',
      '1:30 pm',
      '9:05 am',
    ]);
  });
  it('offers 6 am to 10 pm, plus a saved time that is off the grid, in order', () => {
    const grid = timeChoices('08:00');
    expect(grid).toHaveLength(17);
    expect(grid[0]).toBe('06:00');
    expect(grid.at(-1)).toBe('22:00');
    expect(timeChoices('08:30')).toEqual([...grid.slice(0, 3), '08:30', ...grid.slice(3)]);
    expect(timeChoices('23:00').at(-1)).toBe('23:00');
  });
  it('an unchanged form sends nothing; a moved one sends only what moved, as UTC', () => {
    expect(openingPatch(saved, form)).toEqual({ patch: {} });
    expect(openingPatch(saved, { ...form, generalTime: '09:00' })).toEqual({
      patch: { generalOpenAt: '2026-03-02T17:00:00.000Z' },
    });
    expect(openingPatch(saved, { ...form, personalDate: '2026-02-25', generalDate: '2026-03-03' })).toEqual({
      patch: { personalOpenAt: '2026-02-25T16:00:00.000Z', generalOpenAt: '2026-03-03T16:00:00.000Z' },
    });
  });
  it('a missing date, or a time that doesn’t exist (spring forward), names its field', () => {
    expect(openingPatch(saved, { ...form, personalDate: '' })).toEqual({ bad: 'personal' });
    expect(openingPatch(saved, { ...form, generalDate: '' })).toEqual({ bad: 'general' });
    expect(openingPatch(saved, { ...form, generalDate: '2026-03-08', generalTime: '02:30' })).toEqual({
      bad: 'general',
    });
  });
  it('maps the route’s refusals', () => {
    expect(openingRefusal('personal_after_general')).toEqual({
      field: 'personal',
      message: 'Personal links have to open before the general link.',
    });
    expect(openingRefusal('release_out_of_range')).toEqual({
      field: null,
      message: 'Pick a time between now and the end of the season.',
    });
    expect(openingRefusal('invalid')).toEqual({ field: null, message: ERRORS.generic });
    expect(openingRefusal(null)).toEqual({ field: null, message: ERRORS.generic });
  });
});

describe('A7c replies and stories', () => {
  it('offers 2 or 3 days, plus a saved other value, in order', () => {
    expect(promiseChoices(2)).toEqual([2, 3]);
    expect(promiseChoices(3)).toEqual([2, 3]);
    expect(promiseChoices(1)).toEqual([1, 2, 3]);
    expect(promiseChoices(7)).toEqual([2, 3, 7]);
  });
  it('sends only what changed', () => {
    const s = { replyPromiseDays: 2, before60Enabled: true };
    expect(repliesPatch(s, s)).toEqual({});
    expect(repliesPatch(s, { ...s, replyPromiseDays: 3 })).toEqual({ replyPromiseDays: 3 });
    expect(repliesPatch(s, { ...s, before60Enabled: false })).toEqual({ before60Enabled: false });
  });
});

describe('A7 calendar', () => {
  const now = new Date('2026-03-04T22:00:00Z'); // Wed Mar 4 2026, 2 pm Vancouver (PST under any tzdata)
  it('"checked 7 am" today, "Tue 7 am" on another day, nothing when never', () => {
    expect(checkedLabel('2026-03-04T15:00:00Z', now)).toBe('7 am');
    expect(checkedLabel('2026-03-03T15:00:00Z', now)).toBe('Tue 7 am');
    expect(checkedLabel('2026-03-04T07:30:00Z', now)).toBe('Tue 11:30 pm'); // UTC today, Vancouver yesterday
    expect(checkedLabel(null, now)).toBeNull();
  });
  it('words each Re-sync answer', () => {
    expect(resyncLine({ status: 200, queued: 0, synced: 0 })).toEqual({
      ok: true,
      line: 'Nothing to re-sync: no bookings ahead.',
    });
    expect(resyncLine({ status: 200, queued: 1, synced: 1 }).line).toBe(
      'Your 1 booking is on your calendar.',
    );
    expect(resyncLine({ status: 200, queued: 12, synced: 12 }).line).toBe(
      'All 12 bookings are on your calendar.',
    );
    expect(resyncLine({ status: 200, queued: 12, synced: 5 })).toEqual({
      ok: true,
      line: '5 of 12 bookings are on your calendar; the rest follow in a few minutes.',
    });
    expect(resyncLine({ status: 409 })).toEqual({
      ok: false,
      line: 'Google isn’t connected. Connect it first.',
    });
    expect(resyncLine({ status: 500 })).toEqual({ ok: false, line: ERRORS.generic });
    expect(resyncLine({ status: 200 })).toEqual({ ok: false, line: ERRORS.generic });
    expect(resyncLine(null)).toEqual({ ok: false, line: ERRORS.generic });
  });
  it('words what Google’s consent screen sent back, and nothing else', () => {
    expect(googleResultLine('connected')).toBe('Google is connected.');
    expect(googleResultLine('cancelled')).toMatch(/you said no/);
    expect(googleResultLine('expired')).toMatch(/too long/);
    expect(googleResultLine('foreign_account')).toMatch(/account/);
    expect(googleResultLine('scopes')).toMatch(/every box/);
    expect(googleResultLine('failed')).toBe('Google didn’t connect. Try again.');
    expect(googleResultLine('no_refresh_token')).toBe('Google didn’t connect. Try again.');
    for (const raw of [undefined, '', 'toString', '__proto__', 'nope', ['connected']]) {
      expect(googleResultLine(raw)).toBeNull();
    }
  });
});
