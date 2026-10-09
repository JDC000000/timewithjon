// A2 rows (pack a2): the wait or date, the meta line and the Jon-only flags per filter.
import { describe, expect, it } from 'vitest';
import { JON_FLAGS } from '@/content';
import { INBOX, MAIL } from '@/content/ui/admin-requests';
import type { InboxCard } from '@/features/admin/inbox';
import { vancouverInstant } from '@/lib/time';
import { FILTERS, rowView } from './rows';

const now = vancouverInstant('2027-03-03', '14:00');
const card = (over: Partial<InboxCard> = {}): InboxCard => ({
  id: '11111111-1111-4111-8111-111111111111',
  dish: 'the-long-lunch',
  dishName: 'The Long Lunch',
  mode: 'slots',
  status: 'requested',
  isTest: false,
  contactName: 'Priya',
  crewSize: 3,
  awaitingJonSince: vancouverInstant('2027-03-03', '11:00').toISOString(),
  createdAt: vancouverInstant('2027-03-01', '09:00').toISOString(),
  lockedStartsAt: null,
  lockedEndsAt: null,
  standbyWeek: null,
  noTimesLeft: false,
  timesCount: 2,
  datesCount: 0,
  windowText: null,
  overnight: false,
  countsToward: 'weekly_cap',
  inviteKind: 'general',
  cancelledAt: null,
  cancelledBy: null,
  closedInPerson: false,
  contactProblem: null,
  guestRsvp: null,
  ...over,
});

describe('FILTERS', () => {
  it('the pack order, each on its server tab', () => {
    expect(FILTERS.map((f) => f.key)).toEqual(['needs', 'waiting', 'standby', 'locked', 'done', 'cancelled']);
    expect(FILTERS.map((f) => f.tab)).toEqual([
      'needs_reply',
      'waiting',
      'standby',
      'locked',
      'done',
      'cancelled',
    ]);
  });
});

describe('rowView', () => {
  it('a request waiting on Jon: the wait since awaiting_jon_since, dish and crew', () => {
    expect(rowView(card(), 'needs', now)).toEqual({
      id: card().id,
      who: 'Priya',
      age: '3 h',
      meta: 'The Long Lunch · crew 3 · 2 times',
      flags: [],
    });
  });
  it('with no awaiting_jon_since, the wait runs from when it came in', () => {
    expect(rowView(card({ awaitingJonSince: null }), 'waiting', now).age).toBe('2 d');
  });
  it('a locked booking shows its date on the right and its time in the meta', () => {
    const locked = card({
      status: 'locked',
      lockedStartsAt: vancouverInstant('2027-04-08', '12:00').toISOString(),
      lockedEndsAt: vancouverInstant('2027-04-08', '14:00').toISOString(),
    });
    expect(rowView(locked, 'locked', now)).toMatchObject({
      age: 'Apr 8',
      meta: 'The Long Lunch · Thu Apr 8 · noon–2 pm',
    });
    expect(rowView(locked, 'done', now)).toMatchObject({ age: 'Apr 8' });
  });
  it('a stand-by names its week', () => {
    const sb = card({
      status: 'standby',
      standbyWeek: '2027-04-12',
      dishName: 'The Flat White',
      crewSize: 1,
    });
    expect(rowView(sb, 'standby', now).meta).toBe('The Flat White · crew 1 · week of Apr 12');
    expect(rowView(sb, 'needs', now).meta).toBe('The Flat White · crew 1 · 2 times');
  });
  it('flags: bounced (or complained), RSVP no, no times left; a delayed email is no flag', () => {
    expect(
      rowView(card({ noTimesLeft: true, contactProblem: 'bounced', guestRsvp: 'no' }), 'needs', now).flags,
    ).toEqual([JON_FLAGS.bounced, JON_FLAGS.rsvpNo, INBOX.noTimesLeft]);
    expect(rowView(card({ contactProblem: 'complained' }), 'needs', now).flags).toEqual([JON_FLAGS.bounced]);
    expect(rowView(card({ contactProblem: 'delayed', guestRsvp: 'maybe' }), 'needs', now).flags).toEqual([]);
  });
  it('a failed send leads the flags (T3.2.U1)', () => {
    expect(rowView(card({ noTimesLeft: true }), 'needs', now, true).flags).toEqual([
      MAIL.failed,
      INBOX.noTimesLeft,
    ]);
  });
  it('one time, dates, and a pitch’s own words', () => {
    expect(rowView(card({ timesCount: 1 }), 'needs', now).meta).toBe('The Long Lunch · crew 3 · 1 time');
    expect(
      rowView(
        card({ mode: 'dates', timesCount: 0, datesCount: 2, dishName: 'The Shore Ride', crewSize: 1 }),
        'needs',
        now,
      ).meta,
    ).toBe('The Shore Ride · crew 1 · 2 dates');
    expect(rowView(card({ mode: 'dates', datesCount: 1, timesCount: 0 }), 'needs', now).meta).toBe(
      'The Long Lunch · crew 3 · 1 date',
    );
    expect(
      rowView(
        card({
          mode: 'dates',
          timesCount: 0,
          windowText: 'sometime in June',
          dishName: 'Pitch Me',
          crewSize: 2,
        }),
        'needs',
        now,
      ).meta,
    ).toBe('Pitch Me · crew 2 · sometime in June');
  });
  it('a locked Big Day says so instead of a clock time', () => {
    const bd = card({
      status: 'locked',
      dishName: 'Catch & Release',
      countsToward: 'big_day',
      lockedStartsAt: vancouverInstant('2027-04-10', '07:00').toISOString(),
      lockedEndsAt: vancouverInstant('2027-04-10', '17:00').toISOString(),
    });
    expect(rowView(bd, 'locked', now)).toMatchObject({
      age: 'Apr 10',
      meta: 'Catch & Release · Sat Apr 10 · Big Day',
    });
  });
  it('cancelled: the day it was, who cancelled or closed it, and the date it happened', () => {
    const was = {
      status: 'cancelled' as const,
      lockedStartsAt: vancouverInstant('2027-04-15', '12:00').toISOString(),
      lockedEndsAt: vancouverInstant('2027-04-15', '14:00').toISOString(),
      cancelledAt: vancouverInstant('2027-03-03', '09:00').toISOString(),
    };
    expect(rowView(card({ ...was, cancelledBy: 'guest' }), 'cancelled', now)).toMatchObject({
      age: 'Mar 3',
      meta: 'The Long Lunch · Thu Apr 15 · cancelled by guest',
    });
    expect(rowView(card({ ...was, cancelledBy: 'jon' }), 'cancelled', now).meta).toBe(
      'The Long Lunch · Thu Apr 15 · cancelled by you',
    );
    expect(rowView(card({ ...was, closedInPerson: true, cancelledBy: 'jon' }), 'cancelled', now).meta).toBe(
      'The Long Lunch · Thu Apr 15 · closed (in person)',
    );
    expect(rowView(card({ status: 'cancelled' }), 'cancelled', now)).toMatchObject({
      age: 'Mar 1',
      meta: 'The Long Lunch · cancelled by guest',
    });
  });
  it('an unknown dish slug still reads (the slug)', () => {
    expect(rowView(card({ dishName: null, dish: 'old-dish', timesCount: 0 }), 'needs', now).meta).toBe(
      'old-dish · crew 3',
    );
  });
});

describe('rowView: QA4 M1', () => {
  it('an overnight request says "one night away" in the row meta, after the window or the dates', () => {
    const c = card({
      mode: 'dates',
      timesCount: 0,
      datesCount: 2,
      overnight: true,
      dish: 'the-grind',
      dishName: 'The Grind',
    });
    expect(rowView(c, 'needs', now).meta).toBe('The Grind · crew 3 · 2 dates · one night away');
    const w = card({
      mode: 'dates',
      timesCount: 0,
      windowText: 'late May',
      overnight: true,
      dishName: 'The Grind',
    });
    expect(rowView(w, 'needs', now).meta).toBe('The Grind · crew 3 · late May · one night away');
    expect(rowView(card(), 'needs', now).meta).not.toContain('one night away');
  });
});
