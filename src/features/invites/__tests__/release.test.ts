// C2 release times: each invite kind opens at its own instant. Proto opens both early for the social test
// (T1.7.10), so this closed-config test keeps the not-yet-open path covered.
import { describe, expect, it } from 'vitest';
import { isReleased, opensAt } from '../release';

const settings = {
  personal_open_at: new Date('2027-02-25T16:00:00Z'),
  general_open_at: new Date('2027-03-01T16:00:00Z'),
};

describe('isReleased', () => {
  it('keeps both kinds closed before their release times', () => {
    const before = new Date('2027-02-25T15:59:59Z');
    expect(isReleased('personal', settings, before)).toBe(false);
    expect(isReleased('general', settings, before)).toBe(false);
  });
  it('opens personal invites first, then general invites', () => {
    const between = new Date('2027-02-26T00:00:00Z');
    expect(isReleased('personal', settings, between)).toBe(true);
    expect(isReleased('general', settings, between)).toBe(false);
  });
  it('opens exactly at the release instant', () => {
    expect(isReleased('general', settings, settings.general_open_at)).toBe(true);
    expect(opensAt('general', settings)).toBe(settings.general_open_at);
  });
});
