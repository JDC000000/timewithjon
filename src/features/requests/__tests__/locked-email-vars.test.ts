// E4's vars (r6, approved: Jon 2026-10-09): the place Jon set rides along for "Where: {place}." (Q1); the Long
// Distance (a call) never asks the guest to pick a place (Q2).
import { describe, expect, it } from 'vitest';
import { lockedEmailVars } from '@/features/requests/lock';
import { vancouverInstant } from '@/lib/time';

const at = (t: string) => vancouverInstant('2027-05-13', t);
const vars = (dish: string, placeKnown = false, where: string | null = null) =>
  lockedEmailVars(
    dish,
    at('12:00'),
    at('14:00'),
    null,
    '11111111-1111-4111-8111-111111111111',
    placeKnown,
    where,
  );

describe('lockedEmailVars (E4)', () => {
  it('Q1: the place Jon set, without a trailing full stop (the copy adds its own)', () => {
    expect(vars('the-long-lunch', true, 'Tomahawk, North Van.')).toMatchObject({
      placeKnown: 1,
      where: 'Tomahawk, North Van',
    });
    expect(vars('the-long-lunch', true, '   ')).not.toHaveProperty('where');
  });
  it('Q2: the Long Distance never asks for a place; other dishes still do when nothing is set', () => {
    expect(vars('the-long-distance')).toMatchObject({ placeKnown: 1 });
    expect(vars('the-long-distance')).not.toHaveProperty('where');
    expect(vars('the-long-lunch')).not.toHaveProperty('placeKnown');
  });
});
