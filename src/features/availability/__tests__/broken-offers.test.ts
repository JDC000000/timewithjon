// A lock withdraws the live stand-by offers it makes dead without overlapping them (a Big Day that day, the week's
// cap), and a phone call (counts toward nothing) neither blocks nor is blocked by a Big Day.
import { describe, expect, it } from 'vitest';
import { canLock, type CanLockInput } from '@/features/availability';
import { offersBrokenBy, type OfferOwner } from '@/features/availability/broken-offers';
import { baseInput, booking, slot } from '@/features/availability/fixtures';
import type { Offer } from '@/features/availability/types';
import { vancouverInstant } from '@/lib/time';

const base = baseInput();
const range = (date: string, from: string, to: string) => ({
  startsAt: vancouverInstant(date, from),
  endsAt: vancouverInstant(date, to),
});
const offer = (id: string, requestId: string, o: Partial<Offer>): Offer => ({
  id,
  requestId,
  kind: 'standby_open',
  slotIds: [],
  ranges: [],
  expiresAt: new Date(base.now.getTime() + 48 * 3600e3),
  takenAt: null,
  releasedAt: null,
  ...o,
});
const owners = new Map<string, OfferOwner>([
  ['grind', { status: 'standby', countsToward: 'big_day', dish: 'the-grind' }],
  ['lunch', { status: 'standby', countsToward: 'weekly_cap', dish: 'the-long-lunch' }],
]);
const broken = (
  lock: ReturnType<typeof booking>,
  offers: Offer[],
  bookings: ReturnType<typeof booking>[] = [],
) =>
  offersBrokenBy({
    booking: lock,
    offers,
    owners,
    slots: base.slots,
    now: base.now,
    bookings,
    blocks: [],
    weeks: base.weeks,
    settings: base.settings,
  });

describe('offersBrokenBy', () => {
  it('a Big Day offer on Saturday is broken by an Encore that evening (rule 2(e)), not by one another Saturday', () => {
    const bigDay = offer('o1', 'grind', { ranges: [range('2027-05-22', '09:00', '15:00')] });
    expect(broken(booking('2027-05-22', '19:30', '23:00', 'weekly_cap'), [bigDay])).toEqual(['o1']);
    expect(broken(booking('2027-05-29', '19:30', '23:00', 'weekly_cap'), [bigDay])).toEqual([]);
  });
  it('a lunch offer is broken when the lock fills its week (cap 2), not while the week has room', () => {
    const lunch = offer('o2', 'lunch', { slotIds: [slot(base, '2027-05-13', 'lunch').id] });
    const one = [booking('2027-05-11', '19:00', '21:00', 'weekly_cap')];
    expect(broken(booking('2027-05-14', '19:00', '21:00', 'weekly_cap'), [lunch], one)).toEqual(['o2']);
    expect(broken(booking('2027-05-14', '19:00', '21:00', 'weekly_cap'), [lunch])).toEqual([]);
  });
  it('an offer already dead, the lock’s own request’s offer, and a released offer are not this lock’s doing', () => {
    const lunch = offer('o3', 'lunch', { slotIds: [slot(base, '2027-05-13', 'lunch').id] });
    const full = [
      booking('2027-05-11', '19:00', '21:00', 'weekly_cap'),
      booking('2027-05-12', '19:00', '21:00', 'weekly_cap'),
    ];
    expect(broken(booking('2027-05-14', '19:00', '21:00', 'weekly_cap'), [lunch], full)).toEqual([]);
    const own = booking('2027-05-14', '19:00', '21:00', 'weekly_cap', { requestId: 'lunch' });
    expect(broken(own, [lunch], [full[0]!])).toEqual([]);
    const gone = { ...lunch, releasedAt: base.now };
    expect(broken(booking('2027-05-14', '19:00', '21:00', 'weekly_cap'), [gone], [full[0]!])).toEqual([]);
  });
});

describe('a phone call and a Big Day (operator pick, 2026-10-09)', () => {
  const input = (over: Partial<CanLockInput>): CanLockInput => ({
    now: base.now,
    request: { id: 'me', status: 'requested', countsToward: 'none', dish: 'the-long-distance' },
    mode: 'lock',
    target: { range: range('2027-05-22', '19:00', '20:00') },
    bookings: [],
    blocks: [],
    weeks: base.weeks,
    offers: [],
    settings: base.settings,
    ...over,
  });
  it('a call on a Big Day Saturday locks, and a Big Day on a Saturday with a call locks; an outing still clashes', () => {
    const grind = booking('2027-05-22', '07:00', '12:00', 'big_day');
    expect(canLock(input({ bookings: [grind] })).ok).toBe(true);
    const call = booking('2027-05-22', '19:00', '20:00', 'none');
    const bigDay = {
      request: {
        id: 'me',
        status: 'requested' as const,
        countsToward: 'big_day' as const,
        dish: 'the-grind',
      },
      target: { range: range('2027-05-22', '07:00', '12:00') },
    };
    expect(canLock(input({ ...bigDay, bookings: [call] })).ok).toBe(true);
    const encore = booking('2027-05-22', '19:30', '23:00', 'weekly_cap');
    expect(canLock(input({ ...bigDay, bookings: [encore] }))).toEqual({ ok: false, reason: 'big_day_clash' });
    // The same time is still refused.
    expect(canLock(input({ bookings: [booking('2027-05-22', '19:00', '20:00', 'weekly_cap')] }))).toEqual({
      ok: false,
      reason: 'time_taken',
    });
  });
});
