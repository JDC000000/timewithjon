// T1.6.U2 time zone, T1.6.U4/U5 Send checks, T1.6.U5 starters: the pure parts of the S7/S8 forms.
import { describe, expect, it } from 'vitest';
import { DATES, PITCH, SURPRISE, TIME_ZONE } from '@/content/ui/booking';
import { VALIDATION_MESSAGE } from '@/features/requests/messages';
import { addStarter } from '../../PitchFlow';
import { dateErrors, FIELD_IDS, needErrors, PICKER_ID, pitchErrors } from '../form-errors';
import { ELSEWHERE, initialZoneOption, postedZone } from '../time-zone';

describe('the Long Distance time zone', () => {
  it('starts on the phone’s zone when listed, via its alias, else Somewhere else; Vancouver before hydration', () => {
    expect(initialZoneOption(null)).toBe('America/Vancouver');
    expect(initialZoneOption('America/Toronto')).toBe('America/Toronto');
    expect(initialZoneOption('America/Calgary')).toBe('America/Edmonton');
    expect(initialZoneOption('Europe/Berlin')).toBe('Europe/Paris');
    expect(initialZoneOption('Asia/Tokyo')).toBe(ELSEWHERE);
  });
  it('posts the chosen zone; Somewhere else posts the phone’s zone, or nothing', () => {
    expect(postedZone('Europe/London', 'Asia/Tokyo')).toBe('Europe/London');
    expect(postedZone(ELSEWHERE, 'Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(postedZone(ELSEWHERE, null)).toBeUndefined();
  });
  it('every listed zone is a real IANA zone', () => {
    for (const o of TIME_ZONE.options)
      expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: o.value })).not.toThrow();
  });
});

describe('Send checks', () => {
  it('S7: a date or a rough window, else "Pick a date or two." on the picker', () => {
    expect(dateErrors(['2027-05-08'], '')).toEqual([]);
    expect(dateErrors([], 'sometime in May')).toEqual([]);
    expect(dateErrors([], '   ')).toEqual([
      { key: 'picks', target: PICKER_ID, inline: DATES.noDates, summary: DATES.noDates },
    ]);
  });
  it('S8: what I need to know is required', () => {
    expect(needErrors('Sat, Lynn Canyon, helmet')).toEqual([]);
    expect(needErrors(' \n')).toEqual([
      { key: 'need', target: FIELD_IDS.need, inline: SURPRISE.needError, summary: SURPRISE.needSummary },
    ]);
  });
  it('Pitch Me: the idea, then when', () => {
    expect(pitchErrors('Canoe', 'June')).toEqual([]);
    expect(pitchErrors(' ', ' ').map((e) => [e.key, e.target, e.summary])).toEqual([
      ['idea', FIELD_IDS.idea, PITCH.ideaSummary],
      ['when', FIELD_IDS.when, VALIDATION_MESSAGE.no_dates],
    ]);
    expect(pitchErrors('Canoe', '').map((e) => e.inline)).toEqual([VALIDATION_MESSAGE.no_dates]);
    expect(pitchErrors('', 'June').map((e) => e.inline)).toEqual([PITCH.ideaError]);
  });
});

describe('Pitch Me starters (wireframe 06 n4)', () => {
  it('fill an empty idea, else append on a new line; never replace', () => {
    expect(addStarter('', 'Cook a dish.')).toBe('Cook a dish.');
    expect(addStarter('  \n', 'Cook a dish.')).toBe('Cook a dish.');
    expect(addStarter('Canoe up Indian Arm', 'Build something')).toBe('Canoe up Indian Arm\nBuild something');
    expect(addStarter('Canoe\n\n', 'Build something')).toBe('Canoe\nBuild something');
  });
});
