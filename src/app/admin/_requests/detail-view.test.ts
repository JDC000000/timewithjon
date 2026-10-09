// A3 (pack a3; wireframe 09 A3, A3j, A3k): caption, back link, facts, times. The sealed plan never appears.
import { describe, expect, it } from 'vitest';
import { JON_FLAGS } from '@/content';
import { DETAIL, SHEETS } from '@/content/ui/admin-requests';
import type { RequestDetail } from '@/features/admin/detail';
import { vancouverInstant } from '@/lib/time';
import { detailView } from './detail-view';

const now = vancouverInstant('2027-03-03', '14:00');
const iso = (d: string, t: string) => vancouverInstant(d, t).toISOString();
const base = (over: Partial<RequestDetail> = {}): RequestDetail => ({
  id: '11111111-1111-4111-8111-111111111111',
  dish: 'the-long-lunch',
  dishName: 'The Long Lunch',
  mode: 'slots',
  status: 'requested',
  isTest: false,
  spamSuspect: false,
  contact: { name: 'Priya', email: 'priya@example.com', phone: null },
  crewSize: 3,
  datePrefs: null,
  overnight: false,
  overnightNight: null,
  guestTimeZone: null,
  pitchIdea: null,
  needToKnow: null,
  note: 'Bringing someone from the old days. No shellfish for Sam.',
  before60Note: null,
  jonNote: null,
  hasSealedPlan: false,
  otherRequestsCount: 0,
  awaitingJonSince: iso('2027-03-03', '11:00'),
  createdAt: iso('2027-03-03', '11:00'),
  lockedStartsAt: null,
  lockedEndsAt: null,
  calendarState: 'none',
  standbyWeek: null,
  times: [
    {
      slotId: 's2',
      date: '2027-05-20',
      windowKind: 'lunch',
      startsAt: iso('2027-05-20', '12:00'),
      endsAt: iso('2027-05-20', '14:00'),
      state: 'gone',
      why: 'busy',
      week: { start: '2027-05-17', count: 0, cap: 2 },
    },
    {
      slotId: 's1',
      date: '2027-05-14',
      windowKind: 'lunch',
      startsAt: iso('2027-05-14', '12:00'),
      endsAt: iso('2027-05-14', '14:00'),
      state: 'open',
      why: null,
      week: { start: '2027-05-10', count: 1, cap: 2 },
    },
  ],
  noTimesLeft: false,
  inviteKind: 'general',
  countsToward: 'weekly_cap',
  cancelledAt: null,
  cancelledBy: null,
  closedInPerson: false,
  contactProblem: null,
  guestRsvp: null,
  joinedToRequestId: null,
  joinedHost: null,
  joinedGuests: [],
  ...over,
});

describe('detailView: a request waiting on Jon (pack a3)', () => {
  const v = detailView(base(), now);
  it('caption with the wait apart, back to Requests, the page title', () => {
    expect(v.caption).toEqual({ text: 'Needs a reply · ', unit: '3 h' });
    expect(v.back).toEqual({ href: '/admin', label: 'Requests' });
    expect(v.pageTitle).toBe('Priya · Requests · Time with Jon admin');
    expect(v.open).toBe(true);
    expect(v.filter).toBe('needs');
  });
  it('facts in the pack order, the note as a quote', () => {
    expect(v.facts).toEqual([
      { label: 'Dish', value: 'The Long Lunch' },
      { label: 'Crew', value: '3 of us' },
      { label: 'Link', value: 'General' },
      { label: 'Note', value: '“Bringing someone from the old days. No shellfish for Sam.”', quote: true },
    ]);
  });
  it('their times, earliest first, each open or gone', () => {
    expect(v.times).toEqual([
      {
        slotId: 's1',
        label: 'Fri May 14 · noon–2 pm',
        meta: 'Week of May 10 · 1 of 2',
        open: true,
        lockable: true,
        override: null,
        nth: null,
      },
      {
        slotId: 's2',
        label: 'Thu May 20 · noon–2 pm',
        meta: 'Busy on your calendar',
        open: false,
        lockable: true,
        override: null,
        nth: null,
      },
    ]);
    expect(v.dates).toEqual([]);
  });
});

describe('detailView: other states', () => {
  it('waiting on them (no awaiting_jon_since): one word, still open', () => {
    const v = detailView(base({ status: 'needs_new_time', awaitingJonSince: null }), now);
    expect(v.caption).toEqual({ text: 'Waiting on them' });
    expect(v.open).toBe(true);
    expect(v.back.href).toBe('/admin');
  });
  it('locked: When and Calendar, no crew, back to the Locked in filter', () => {
    const v = detailView(
      base({
        status: 'locked',
        awaitingJonSince: null,
        lockedStartsAt: iso('2027-05-13', '12:00'),
        lockedEndsAt: iso('2027-05-13', '14:00'),
        calendarState: 'synced',
        note: null,
      }),
      now,
    );
    expect(v.caption).toEqual({ text: 'Locked in' });
    expect(v.back).toEqual({ href: '/admin#locked', label: 'Locked in' });
    expect(v.pageTitle).toBe('Priya · Locked in · Time with Jon admin');
    expect(v.facts).toEqual([
      { label: 'Dish', value: 'The Long Lunch' },
      { label: 'When', value: 'Thu May 13 · noon–2 pm' },
      { label: 'Calendar', value: DETAIL.calendarState.synced },
    ]);
    expect(v.open).toBe(false);
    expect(v.cancelWords).toEqual({ dish: 'Long Lunch', day: 'Thu May 13' });
    expect(v.bigDayLocked).toBe(false);
  });
  it('a locked Big Day gets the weather call; a pitch is marked; dated requests keep their date keys', () => {
    expect(
      detailView(base({ status: 'locked', countsToward: 'big_day', awaitingJonSince: null }), now)
        .bigDayLocked,
    ).toBe(true);
    expect(detailView(base({ status: 'done', countsToward: 'big_day' }), now).bigDayLocked).toBe(false);
    expect(detailView(base({ dish: 'pitch-me' }), now).pitch).toBe(true);
    expect(
      detailView(base({ mode: 'dates', times: [], datePrefs: { dates: ['2027-05-08'] } }), now).dateKeys,
    ).toEqual(['2027-05-08']);
    expect(detailView(base(), now).dateKeys).toEqual([]);
    expect(detailView(base(), now).cancelWords).toBeNull();
  });
  it('done and cancelled go back to their filters and drop Calendar', () => {
    const range = { lockedStartsAt: iso('2027-04-15', '12:00'), lockedEndsAt: iso('2027-04-15', '14:00') };
    const done = detailView(base({ status: 'done', ...range }), now);
    expect(done.back).toEqual({ href: '/admin#done', label: 'Done' });
    expect(done.facts.map((f) => f.label)).toEqual(['Dish', 'When', 'Note']);
    const cancelled = detailView(base({ status: 'cancelled', ...range }), now);
    expect(cancelled.caption).toEqual({ text: 'Cancelled by guest' });
    expect(cancelled.facts.map((f) => f.label)).toEqual(['Dish', 'Was', 'Note']);
    expect(cancelled.back).toEqual({ href: '/admin#cancelled', label: 'Cancelled' });
  });
  it('stand-by names its week', () => {
    const v = detailView(base({ status: 'standby', standbyWeek: '2027-04-12' }), now);
    expect(v.caption).toEqual({ text: 'Stand-by · week of Apr 12' });
    expect(v.back.href).toBe('/admin#standby');
    expect(detailView(base({ status: 'standby' }), now).caption).toEqual({ text: 'Stand-by' });
  });
  it('stand-by can be acted on like an open request (Lock it in, Suggest), and stays under its Stand-by tab', () => {
    const v = detailView(base({ status: 'standby', standbyWeek: '2027-04-12' }), now);
    expect(v.open).toBe(true); // the action bar; no "Before 60" box: that is for after the time together
    expect(v.filter).toBe('standby');
    expect(v.back).toEqual({ href: '/admin#standby', label: 'Stand-by' });
    expect(v.pageTitle).toContain('Stand-by');
  });
  it('Surprise Me: only that a sealed plan exists, and what Jon needs to know', () => {
    const v = detailView(
      base({
        dishName: 'Surprise Me',
        hasSealedPlan: true,
        needToKnow: 'Shoes you can get wet.',
        note: null,
        crewSize: 4,
      }),
      now,
    );
    expect(v.facts).toEqual([
      { label: 'Dish', value: 'Surprise Me' },
      { label: 'Crew', value: '4 of us' },
      { label: 'Link', value: 'General' },
      { label: 'The plan', value: DETAIL.sealed },
      { label: 'You need', value: '“Shoes you can get wet.”', quote: true },
    ]);
  });
  it('a pitch: the idea as a quote and its "when" words; a crew of one is "Just me"', () => {
    const v = detailView(
      base({
        dishName: 'Pitch Me',
        mode: 'dates',
        pitchIdea: 'Three nights kayaking.',
        datePrefs: { dates: [], window_text: 'sometime in June' },
        crewSize: 1,
        note: null,
        times: [],
      }),
      now,
    );
    expect(v.facts).toEqual([
      { label: 'Dish', value: 'Pitch Me' },
      { label: 'Idea', value: '“Three nights kayaking.”', quote: true },
      { label: 'When', value: 'sometime in June' },
      { label: 'Crew', value: 'Just me' },
      { label: 'Link', value: 'General' },
    ]);
  });
  it('dates mode lists their dates; junk in date_prefs is ignored', () => {
    const v = detailView(
      base({ mode: 'dates', times: [], datePrefs: { dates: ['2027-05-08', 7, '2027-05-16'] } }),
      now,
    );
    expect(v.dates).toEqual(['Sat May 8', 'Sun May 16']);
    expect(detailView(base({ mode: 'dates', times: [], datePrefs: 'nope' }), now).dates).toEqual([]);
  });
  it('an unknown dish slug still reads', () => {
    expect(detailView(base({ dishName: null, dish: 'old' }), now).facts[0]).toEqual({
      label: 'Dish',
      value: 'old',
    });
  });
});

describe('detailView: flags, links, captions and each time’s reason (Q2 fields)', () => {
  const t = (
    why: RequestDetail['times'][number]['why'],
    week = { start: '2027-05-10', count: 2, cap: 2 },
  ) => ({
    slotId: String(why),
    date: '2027-05-14',
    windowKind: 'lunch' as const,
    startsAt: iso('2027-05-14', '12:00'),
    endsAt: iso('2027-05-14', '14:00'),
    state: why ? ('gone' as const) : ('open' as const),
    why,
    week,
  });
  it('a personal link is named in the caption, and no Link fact', () => {
    const v = detailView(base({ inviteKind: 'personal' }), now);
    expect(v.caption).toEqual({ text: 'Needs a reply · ', unit: '3 h', after: ' · personal link' });
    expect(v.facts.map((f) => f.label)).not.toContain('Link');
  });
  it('flags come from the bounce, the RSVP and no times left (no big-crew flag: crew stays within the dish)', () => {
    expect(detailView(base({ contactProblem: 'bounced', guestRsvp: 'no' }), now).flags).toEqual([
      JON_FLAGS.bounced,
      JON_FLAGS.rsvpNo,
    ]);
  });
  it('a locked Big Day says so; a cancel names who and when; closed in person too', () => {
    expect(detailView(base({ status: 'locked', countsToward: 'big_day' }), now).caption).toEqual({
      text: 'Locked in · Big Day',
    });
    const at = iso('2027-03-03', '09:00');
    expect(
      detailView(base({ status: 'cancelled', cancelledBy: 'guest', cancelledAt: at }), now).caption,
    ).toEqual({
      text: 'Cancelled by guest · Wed Mar 3',
    });
    expect(
      detailView(base({ status: 'cancelled', cancelledBy: 'jon', cancelledAt: at }), now).caption.text,
    ).toBe('Cancelled by you · Wed Mar 3');
    expect(
      detailView(base({ status: 'cancelled', closedInPerson: true, cancelledBy: 'jon' }), now).caption.text,
    ).toBe('Closed (in person)');
  });
  it('each reason: what it says, whether it can still be locked, and with which override', () => {
    const v = detailView(
      base({ times: [t('week_full'), t('blocked'), t('taken'), t('past'), t('window')] }),
      now,
    );
    expect(v.times.map((x) => [x.meta, x.open, x.lockable, x.override, x.nth])).toEqual([
      ['Week of May 10 · 2 of 2', false, true, 'overrideWeek', 3],
      ['Blocked by you', false, true, 'bookAnyway', null],
      ['Taken', false, false, null, null],
      [DETAIL.timeMeta.past, false, false, null, null],
      [DETAIL.timeMeta.window, false, false, null, null],
    ]);
  });
});

describe('detailView: a possible spam request (Check these, A2b)', () => {
  it('only the email, what they picked and the note; no lock bar; back to Check these', () => {
    const v = detailView(
      base({
        spamSuspect: true,
        contact: { name: ' ', email: 'x7@example.com', phone: null },
        note: 'best deals',
      }),
      now,
    );
    expect(v).toMatchObject({
      who: '(no name)',
      caption: { text: 'Check these · possible spam' },
      back: { href: '/admin?check=1', label: 'Requests' },
      pageTitle: 'Check these · Time with Jon admin',
      open: false,
      spam: true,
      times: [],
      flags: [],
    });
    expect(v.facts).toEqual([
      { label: 'Email', value: 'x7@example.com' },
      { label: 'Picked', value: '2 times' },
      { label: 'Note', value: '“best deals”', quote: true },
    ]);
    const dated = detailView(
      base({ spamSuspect: true, mode: 'dates', note: null, datePrefs: { dates: ['2027-05-08'] } }),
      now,
    );
    expect(dated.who).toBe('Priya');
    expect(dated.facts).toEqual([
      { label: 'Email', value: 'priya@example.com' },
      { label: 'Picked', value: '1 date' },
    ]);
  });
});

describe('detailView: failed sends (T3.2.U1)', () => {
  it('a failed email flags the request and carries its Resend', () => {
    const v = detailView(base(), now, [
      { id: 'e1', resendable: true },
      { id: 'e2', resendable: false },
    ]);
    expect(v.flags[0]).toBe('Email didn’t send');
    expect(v.failed).toEqual([
      { id: 'e1', resendable: true },
      { id: 'e2', resendable: false },
    ]);
    expect(detailView(base(), now).failed).toEqual([]);
    expect(detailView(base(), now).flags).toEqual([]);
  });
});

// QA4 (proto walkthrough r4, 2026-10-08): what the guest told Jon must reach the detail.
describe('detailView: QA4 M1 one night away, M2 rough window, L3 time zone', () => {
  const hike = (over: Partial<RequestDetail> = {}) =>
    base({ dish: 'the-grind', dishName: 'The Grind', mode: 'dates', times: [], note: null, ...over });

  it('M1: an overnight request says "one night away" (the guest’s words) and the Lock sheet knows', () => {
    const v = detailView(hike({ overnight: true, datePrefs: { dates: ['2027-05-08', '2027-05-15'] } }), now);
    expect(v.facts).toContainEqual({ label: DETAIL.labels.away, value: 'one night away' });
    expect(v.overnight).toBe(true);
    expect(
      detailView(hike({ datePrefs: { dates: ['2027-05-08'] } }), now).facts.map((f) => f.label),
    ).not.toContain(DETAIL.labels.away);
  });
  it('M1: a pitch’s "Which night?" answer rides with it, as their words', () => {
    const v = detailView(
      hike({
        dish: 'pitch-me',
        pitchIdea: 'Hut trip.',
        overnight: true,
        overnightNight: 'Sat May 8, near Squamish',
      }),
      now,
    );
    expect(v.facts).toContainEqual({
      label: DETAIL.labels.away,
      value: 'one night away · “Sat May 8, near Squamish”',
    });
  });
  it('M2: a rough window shows on every dated dish, not only a pitch, and Lock in opens the dates sheet', () => {
    const v = detailView(hike({ datePrefs: { dates: [], window_text: 'Any weekend in late May' } }), now);
    expect(v.facts).toContainEqual({ label: DETAIL.labels.when, value: 'Any weekend in late May' });
    expect(v.datesMode).toBe(true);
    expect(v.dateKeys).toEqual([]);
    // the manage / new-date forms send dates and a window together: both show
    const both = detailView(hike({ datePrefs: { dates: ['2027-05-29'], window_text: 'or June' } }), now);
    expect(both.facts).toContainEqual({ label: DETAIL.labels.when, value: 'or June' });
    expect(both.dates).toEqual(['Sat May 29']);
    expect(detailView(base(), now).datesMode).toBe(false); // a slots request keeps its times bar
  });
  it('L3: a Long Distance guest’s zone is named as the booking form names it; another zone reads as its id', () => {
    const ld = (zone: string) =>
      detailView(
        hike({ dish: 'the-long-distance', guestTimeZone: zone, datePrefs: { dates: ['2027-05-08'] } }),
        now,
      );
    expect(ld('America/St_Johns').facts).toContainEqual({
      label: DETAIL.labels.zone,
      value: 'St. John’s (Newfoundland)',
    });
    expect(ld('Asia/Kolkata').facts).toContainEqual({ label: DETAIL.labels.zone, value: 'Asia/Kolkata' });
    expect(ld('America/Argentina/Buenos_Aires').facts).toContainEqual({
      label: DETAIL.labels.zone,
      value: 'America/Argentina/Buenos Aires',
    });
    expect(detailView(hike(), now).facts.map((f) => f.label)).not.toContain(DETAIL.labels.zone);
  });
});

describe('detailView: a shared booking (QA4b M3)', () => {
  const HOST = '22222222-2222-4222-8222-222222222222';
  const GUEST = '33333333-3333-4333-8333-333333333333';
  const time = { lockedStartsAt: iso('2027-05-27', '12:00'), lockedEndsAt: iso('2027-05-27', '14:00') };
  it('the joined guest: the shared time, and a link to the booking it rides on; Make host not offered', () => {
    const v = detailView(
      base({
        status: 'locked',
        awaitingJonSince: null,
        ...time, // the host's (detail.ts reads it for a joined guest)
        joinedToRequestId: HOST,
        joinedHost: { id: HOST, name: 'Bea', on: true },
      }),
      now,
    );
    expect(v.facts).toContainEqual({ label: DETAIL.labels.when, value: 'Thu May 27 · noon–2 pm' });
    expect(v.joinedTo).toEqual({ text: SHEETS.join.joined('Bea'), href: `/admin/requests/${HOST}` });
    expect(v.canPromote).toBe(false); // the host is still on: the server refuses it (host_still_locked)
    expect(v.cancelWords).not.toBeNull(); // Cancel for the guest has its day
  });
  it('the host: who rides on the booking, each name a link to their page', () => {
    const v = detailView(
      base({
        status: 'locked',
        awaitingJonSince: null,
        ...time,
        joinedGuests: [
          { id: GUEST, name: 'Priya' },
          { id: HOST, name: 'Sam' },
        ],
      }),
      now,
    );
    expect(v.facts).toContainEqual({
      label: DETAIL.labels.with,
      value: 'Priya, Sam',
      links: [
        { text: 'Priya', href: `/admin/requests/${GUEST}` },
        { text: 'Sam', href: `/admin/requests/${HOST}` },
      ],
    });
    expect(v.joinedTo).toBeNull();
  });
  it('after the host left (rule 4): Make host is offered; no "Joined to" line', () => {
    const v = detailView(
      base({
        status: 'needs_new_time',
        joinedToRequestId: HOST,
        joinedHost: { id: HOST, name: 'Bea', on: false },
      }),
      now,
    );
    expect(v.canPromote).toBe(true);
    expect(v.joinedTo).toBeNull();
    expect(detailView(base(), now).canPromote).toBe(false);
  });
});
