// T2.5.U1: the A4c away form's rules and live summary (pack a4c + site.js data-validate; ruling Q2: confirm by = Back
// on + 2 days).
import { describe, expect, it } from 'vitest';
import { AWAY } from '@/content/ui/admin-season';
import { awayErrors, awaySummary, confirmByFor } from '../away-model';

const fields = (from: string, to: string) => awayErrors(from, to).map((e) => [e.field, e.inline, e.summary]);

describe('awayErrors', () => {
  it('both dates missing: both, in page order, with the pack words', () => {
    expect(fields('', ' ')).toEqual([
      ['from', 'Add a date.', 'Add the first day away.'],
      ['to', 'Add a date.', 'Add the day you’re back.'],
    ]);
  });
  it('Back on on or before From', () => {
    const after = ['to', 'Back on has to be after From.', 'Back on has to be after From.'];
    expect(fields('2027-04-24', '2027-04-24')).toEqual([after]);
    expect(fields('2027-04-24', '2027-04-23')).toEqual([after]);
    expect(fields('2027-04-24', '2027-04-25')).toEqual([]);
  });
  it('only a missing From: no "after" check against nothing', () => {
    expect(fields('', '2027-04-25')).toEqual([['from', 'Add a date.', 'Add the first day away.']]);
    expect(fields('2027-04-2', '2027-05-03').map((e) => e[0])).toEqual(['from']);
    expect(fields('2027-05', '2027-04-30').map((e) => e[0])).toEqual(['from']); // a partial From: no after-check
  });
});

describe('awaySummary', () => {
  it('the pack range: Sat Apr 24 to Mon May 3, confirm by May 5', () => {
    expect(awaySummary('2027-04-24', '2027-05-03')).toEqual({
      confirmBy: '2027-05-05',
      notice: 'I’m away until May 3. I’ll confirm by May 5.',
      hides: 'Hides every time from Sat Apr 24 to Mon May 3.',
      requests: 'Requests still come in. Your reply promise restarts on May 3.',
    });
  });
  it('none while the range is not valid', () => {
    expect(awaySummary('2027-04-24', '')).toBeNull();
    expect(awaySummary('2027-04-24', '2027-04-24')).toBeNull();
  });
  it('confirm by crosses a month', () => {
    expect(confirmByFor('2027-04-30')).toBe('2027-05-02');
  });
});

describe('AWAY words', () => {
  it('locked bookings in the range, and the summary title', () => {
    expect([0, 1, 3].map(AWAY.locked)).toEqual([
      'No locked bookings in that range.',
      '1 locked booking in that range.',
      '3 locked bookings in that range.',
    ]);
    expect([1, 2, 3, 5].map(AWAY.toFix)).toEqual([
      'One thing to fix',
      'Two things to fix',
      'Three things to fix',
      '5 things to fix',
    ]);
  });
});
